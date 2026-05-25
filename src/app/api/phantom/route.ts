import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getBacCache, setBacCache, getUser } from '@/lib/kv';
import { calculateBac }              from '@/lib/bac';
import type { CachedCheckin }        from '@/lib/kv';

/**
 * POST /api/phantom
 * Body: { beerName: string; abv: number; volumeMl: number; createdAtMs: number }
 *
 * Adds a manually-entered "phantom" beer to the BAC cache, then recalculates.
 * Phantom beers survive Untappd syncs and are stored alongside real checkins.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const body = await req.json() as {
    beerName?: unknown;
    abv?: unknown;
    volumeMl?: unknown;
    createdAtMs?: unknown;
  };

  const beerName    = typeof body.beerName   === 'string'  ? body.beerName.trim() : '';
  const abv         = typeof body.abv        === 'number'  ? body.abv             : NaN;
  const volumeMl    = typeof body.volumeMl   === 'number'  ? body.volumeMl        : NaN;
  const createdAtMs = typeof body.createdAtMs === 'number' ? body.createdAtMs     : NaN;

  if (!beerName || isNaN(abv) || isNaN(volumeMl) || isNaN(createdAtMs)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  if (abv < 0 || abv > 100 || volumeMl <= 0 || volumeMl > 5000) {
    return NextResponse.json({ error: 'values out of range' }, { status: 400 });
  }

  const [cache, user] = await Promise.all([
    getBacCache(session.userId),
    getUser(session.userId),
  ]);

  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  // Generate a unique negative ID to distinguish phantoms from Untappd checkins
  const phantomId = -(Date.now());

  // Purge any phantoms that have aged out of the 24h window
  const cutoffMs = Date.now() - 24 * 60 * 60_000;
  const phantom: CachedCheckin = {
    checkinId:        phantomId,
    beerName,
    breweryName:      '',
    style:            '',
    abv,
    servingType:      'phantom',
    createdAtMs,
    volumeMlOverride: volumeMl,
    phantom:          true,
  };

  const updatedCheckins = [
    ...(cache?.checkins ?? []).filter(c => !c.phantom || c.createdAtMs >= cutoffMs),
    phantom,
  ];

  const result = calculateBac(
    updatedCheckins.map(c => ({
      createdAtMs:      c.createdAtMs,
      abv:              c.abv,
      servingType:      c.servingType,
      volumeMlOverride: c.volumeMlOverride,
    })),
    user.weightKg,
    user.gender,
  );

  await setBacCache(session.userId, { ...result, checkins: updatedCheckins });

  return NextResponse.json({ ...result, checkins: updatedCheckins });
}
