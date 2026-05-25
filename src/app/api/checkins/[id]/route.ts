import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getBacCache, setBacCache, getUser } from '@/lib/kv';
import { calculateBac }              from '@/lib/bac';

/**
 * PATCH /api/checkins/:id
 * Body: { volumeMl: number | null }
 * Sets (or clears) the serving-volume override for a checkin, then
 * recalculates BAC from the cached checkin list and saves the result.
 *
 * DELETE /api/checkins/:id
 * Removes a phantom beer (phantom === true only) from the cache and
 * recalculates BAC.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  const checkinId = parseInt(id, 10);
  if (isNaN(checkinId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const body = await req.json() as { volumeMl?: number | null };
  const volumeMl: number | null = body.volumeMl ?? null;

  const [cache, user] = await Promise.all([
    getBacCache(session.userId),
    getUser(session.userId),
  ]);

  if (!cache || !user) {
    return NextResponse.json({ error: 'no cached data — sync first' }, { status: 404 });
  }

  const cutoffMs = Date.now() - 24 * 60 * 60_000;
  const updatedCheckins = cache.checkins
    .filter(c => !c.phantom || c.createdAtMs >= cutoffMs)
    .map(c =>
      c.checkinId === checkinId
        ? { ...c, volumeMlOverride: volumeMl === null ? undefined : volumeMl }
        : c,
    );

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

  await setBacCache(session.userId, { ...result, checkins: updatedCheckins });

  return NextResponse.json({ ...result, checkins: updatedCheckins });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  const checkinId = parseInt(id, 10);
  if (isNaN(checkinId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const [cache, user] = await Promise.all([
    getBacCache(session.userId),
    getUser(session.userId),
  ]);

  if (!cache || !user) {
    return NextResponse.json({ error: 'no cached data — sync first' }, { status: 404 });
  }

  const target = cache.checkins.find(c => c.checkinId === checkinId);
  if (!target) {
    return NextResponse.json({ error: 'checkin not found' }, { status: 404 });
  }
  if (!target.phantom) {
    return NextResponse.json({ error: 'only phantom beers can be deleted' }, { status: 403 });
  }

  const updatedCheckins = cache.checkins.filter(c => c.checkinId !== checkinId);

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

  await setBacCache(session.userId, { ...result, checkins: updatedCheckins });

  return NextResponse.json({ ...result, checkins: updatedCheckins });
}
