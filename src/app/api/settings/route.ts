import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getUser, setUser, getBacCache, setBacCache } from '@/lib/kv';
import { calculateBac }              from '@/lib/bac';

/**
 * POST /api/settings
 * Body: { weightKg: number; gender: 'male' | 'female' }
 * Updates the user's profile and recalculates BAC from the cached checkins.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const body = await req.json() as { weightKg?: unknown; gender?: unknown };

  const weightKg = Number(body.weightKg);
  if (!isFinite(weightKg) || weightKg < 30 || weightKg > 300) {
    return NextResponse.json({ error: 'invalid weightKg' }, { status: 400 });
  }
  if (body.gender !== 'male' && body.gender !== 'female') {
    return NextResponse.json({ error: 'invalid gender' }, { status: 400 });
  }
  const gender = body.gender;

  const user = await getUser(session.userId);
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  // Save updated profile
  await setUser(session.userId, { ...user, weightKg, gender });

  // Recalculate BAC from cached checkins with new body parameters
  const cache = await getBacCache(session.userId);
  if (cache) {
    const result = calculateBac(
      cache.checkins.map(c => ({
        createdAtMs:      c.createdAtMs,
        abv:              c.abv,
        servingType:      c.servingType,
        volumeMlOverride: c.volumeMlOverride,
      })),
      weightKg,
      gender,
    );
    await setBacCache(session.userId, { ...result, checkins: cache.checkins });
    return NextResponse.json({ ...result, checkins: cache.checkins });
  }

  return NextResponse.json({ ok: true });
}
