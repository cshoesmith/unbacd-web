import { NextRequest, NextResponse } from 'next/server';
import { getDevice, getUser, getBacCache, setBacCache } from '@/lib/kv';
import { fetchCheckins, parseUntappdDate, RateLimitError } from '@/lib/untappd';
import { calculateBac } from '@/lib/bac';

const CACHE_FRESH_MS = 5 * 60_000; // serve cached result if < 5 min old

/**
 * GET /api/bac?device={token}
 *
 * Called by the Wear OS watch on every 30-second tick.
 * Returns current BAC data, triggering a fresh Untappd sync if the cache is stale.
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

  // Return cached result if still fresh
  const cached = await getBacCache(device.userId);
  if (cached && Date.now() - cached.calculatedAt < CACHE_FRESH_MS) {
    return NextResponse.json({
      bac:          cached.bac,
      soberMs:      cached.soberMs,
      drinkCount:   cached.drinkCount,
      calculatedAt: cached.calculatedAt,
      username:     user.username,
      fromCache:    true,
    });
  }

  // Stale — fetch fresh checkins and recalculate
  try {
    const raw = await fetchCheckins(user.untappdToken);
    const cutoffMs = Date.now() - 24 * 60 * 60_000;
    const checkins = raw
      .map(c => ({ createdAtMs: parseUntappdDate(c.createdAt), abv: c.abv, servingType: c.servingType }))
      .filter(c => c.createdAtMs >= cutoffMs);

    const result = calculateBac(checkins, user.weightKg, user.gender);

    const cacheEntry = {
      ...result,
      checkins: raw
        .filter(c => parseUntappdDate(c.createdAt) >= cutoffMs)
        .map(c => ({
          checkinId:   c.checkinId,
          beerName:    c.beerName,
          breweryName: c.breweryName,
          style:       c.style,
          abv:         c.abv,
          servingType: c.servingType,
          createdAtMs: parseUntappdDate(c.createdAt),
        })),
    };
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
      // Serve stale cache rather than erroring during rate-limit windows
      return NextResponse.json({
        bac:          cached.bac,
        soberMs:      cached.soberMs,
        drinkCount:   cached.drinkCount,
        calculatedAt: cached.calculatedAt,
        username:     user.username,
        fromCache:    true,
        stale:        true,
      });
    }
    console.error('[/api/bac] sync error:', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 503 });
  }
}
