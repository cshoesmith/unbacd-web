import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getBacCache, setBacCache, getUser, getDevice } from '@/lib/kv';
import { calculateBac }              from '@/lib/bac';
import type { CachedCheckin }        from '@/lib/kv';

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (session.userId) return session.userId;

  const deviceToken = req.nextUrl.searchParams.get('device');
  if (!deviceToken) return null;
  const device = await getDevice(deviceToken);
  return device?.userId ?? null;
}

/**
 * POST /api/phantom
 * Body: { beerName: string; abv: number; volumeMl: number; createdAtMs: number }
 *
 * Adds a manually-entered "phantom" beer to the BAC cache, then recalculates.
 * Phantom beers survive Untappd syncs and are stored alongside real checkins.
 */
export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const body = await req.json() as {
    beerName?: unknown;
    abv?: unknown;
    volumeMl?: unknown;
    createdAtMs?: unknown;
    repeat?: unknown;
  };

  const beerName    = typeof body.beerName   === 'string'  ? body.beerName.trim() : '';
  const abv         = typeof body.abv        === 'number'  ? body.abv             : NaN;
  const volumeMl    = typeof body.volumeMl   === 'number'  ? body.volumeMl        : NaN;
  const createdAtMs = typeof body.createdAtMs === 'number' ? body.createdAtMs     : NaN;
  const repeat      = typeof body.repeat     === 'boolean' ? body.repeat         : false;

  if (!beerName || isNaN(abv) || isNaN(volumeMl) || isNaN(createdAtMs)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  if (abv < 0 || abv > 100 || volumeMl <= 0 || volumeMl > 5000) {
    return NextResponse.json({ error: 'values out of range' }, { status: 400 });
  }

  const [cache, user] = await Promise.all([
    getBacCache(userId),
    getUser(userId),
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
    repeat:           repeat ? true : undefined,
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
    user.defaultServingMl,
  );

  await setBacCache(userId, { ...result, checkins: updatedCheckins });

  return NextResponse.json({ ...result, checkins: updatedCheckins });
}
