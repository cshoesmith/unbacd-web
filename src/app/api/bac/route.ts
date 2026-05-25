import { NextRequest, NextResponse } from 'next/server';
import { getDevice, getUser, getBacCache, setBacCache } from '@/lib/kv';
import { fetchCheckins, parseUntappdDate, RateLimitError } from '@/lib/untappd';
import { calculateBac } from '@/lib/bac';

// Only re-fetch checkins from Untappd if data is older than this.
// BAC is always recalculated at the current time regardless.
const UNTAPPD_FRESH_MS = 5 * 60_000;

/**
 * GET /api/bac?device={token}
 *
 * Called by the Wear OS watch on its own polling cadence.
 * BAC is always recalculated from the cached checkin list at the current
 * timestamp — the watch drives when updates happen.  A fresh Untappd fetch
 * is only triggered when the checkin data itself is older than UNTAPPD_FRESH_MS.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('device');
  if (!token) {
    return NextResponse.json({ error: 'missing device token' }, { status: 400 });
  }

  const device = await getDevice(token);
  if (!device) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }

  const user = await getUser(device.userId);
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  const cached = await getBacCache(device.userId);

  // Checkin data is fresh — recalculate BAC right now from the cached list.
  // The watch controls the cadence; the server just does the math.
  if (cached && Date.now() - cached.calculatedAt < UNTAPPD_FRESH_MS) {
    const result = calculateBac(
      cached.checkins.map(c => ({
        createdAtMs:      c.createdAtMs,
        abv:              c.abv,
        servingType:      c.servingType,
        volumeMlOverride: c.volumeMlOverride,
      })),
      user.weightKg,
      user.gender,
      user.defaultServingMl,
    );
    return NextResponse.json({
      bac:          result.bac,
      soberMs:      result.soberMs,
      drinkCount:   result.drinkCount,
      calculatedAt: result.calculatedAt,
      username:     user.username,
      fromCache:    true,
    });
  }

  // Stale — fetch fresh checkins and recalculate
  try {
    const raw = await fetchCheckins(user.untappdToken);
    const cutoffMs = Date.now() - 24 * 60 * 60_000;

    // Re-apply any per-checkin serving overrides the user set via the web app
    const overrideMap = new Map<number, number>(
      (cached?.checkins ?? [])
        .filter(c => c.volumeMlOverride != null && !c.phantom)
        .map(c => [c.checkinId, c.volumeMlOverride!]),
    );

    // Preserve phantom beers that are still within the 24h window
    const phantoms = (cached?.checkins ?? []).filter(c => c.phantom && c.createdAtMs >= cutoffMs);

    const freshCheckins = raw
      .filter(c => parseUntappdDate(c.createdAt) >= cutoffMs)
      .map(c => ({
        checkinId:        c.checkinId,
        beerName:         c.beerName,
        breweryName:      c.breweryName,
        style:            c.style,
        abv:              c.abv,
        servingType:      c.servingType,
        createdAtMs:      parseUntappdDate(c.createdAt),
        volumeMlOverride: overrideMap.get(c.checkinId),
      }));

    const allCheckins = [...freshCheckins, ...phantoms];

    const result = calculateBac(
      allCheckins.map(c => ({
        createdAtMs:      c.createdAtMs,
        abv:              c.abv,
        servingType:      c.servingType,
        volumeMlOverride: c.volumeMlOverride,
      })),
      user.weightKg,
      user.gender,
      user.defaultServingMl,
    );

    const cacheEntry = { ...result, checkins: allCheckins };
    await setBacCache(device.userId, cacheEntry);

    return NextResponse.json({
      bac:          result.bac,
      soberMs:      result.soberMs,
      drinkCount:   result.drinkCount,
      calculatedAt: result.calculatedAt,
      username:     user.username,
      fromCache:    false,
    });
  } catch (err) {
    if (err instanceof RateLimitError && cached) {
      // Rate-limited — recalculate BAC from cached checkins rather than erroring
      const result = calculateBac(
        cached.checkins.map(c => ({
          createdAtMs:      c.createdAtMs,
          abv:              c.abv,
          servingType:      c.servingType,
          volumeMlOverride: c.volumeMlOverride,
        })),
        user.weightKg,
        user.gender,
        user.defaultServingMl,
      );
      return NextResponse.json({
        bac:          result.bac,
        soberMs:      result.soberMs,
        drinkCount:   result.drinkCount,
        calculatedAt: result.calculatedAt,
        username:     user.username,
        fromCache:    true,
        stale:        true,
      });
    }
    console.error('[/api/bac] sync error:', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 503 });
  }
}
