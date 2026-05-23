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

  const updatedCheckins = cache.checkins.map(c =>
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
  );

  await setBacCache(session.userId, { ...result, checkins: updatedCheckins });

  return NextResponse.json({ ...result, checkins: updatedCheckins });
}
