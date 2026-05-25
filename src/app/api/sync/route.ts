import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getUser, getBacCache, setBacCache } from '@/lib/kv';
import { fetchCheckins, parseUntappdDate, RateLimitError } from '@/lib/untappd';
import { calculateBac }              from '@/lib/bac';

/**
 * POST /api/sync
 * Authenticated (browser session). Fetches fresh checkins and rebuilds BAC cache.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const user = await getUser(session.userId);
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  try {
    const [raw, existingCache] = await Promise.all([
      fetchCheckins(user.untappdToken),
      getBacCache(session.userId),
    ]);
    const cutoffMs = Date.now() - 24 * 60 * 60_000;

    // Re-apply any per-checkin serving overrides the user set
    const overrideMap = new Map<number, number>(
      (existingCache?.checkins ?? [])
        .filter(c => c.volumeMlOverride != null && !c.phantom)
        .map(c => [c.checkinId, c.volumeMlOverride!]),
    );

    // Preserve phantom beers (manually added, not from Untappd)
    const phantoms = (existingCache?.checkins ?? []).filter(c => c.phantom);

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
    );

    await setBacCache(session.userId, { ...result, checkins: allCheckins });

    return NextResponse.json({ ...result, checkins: allCheckins });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: 'rate limited by Untappd' }, { status: 429 });
    }
    console.error('[/api/sync]', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 503 });
  }
}
