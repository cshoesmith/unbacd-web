import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getUser, setBacCache }      from '@/lib/kv';
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
    const raw = await fetchCheckins(user.untappdToken);
    const checkins = raw.map(c => ({
      createdAtMs: parseUntappdDate(c.createdAt),
      abv:         c.abv,
      servingType: c.servingType,
    }));

    const result = calculateBac(checkins, user.weightKg, user.gender);

    await setBacCache(session.userId, {
      ...result,
      checkins: raw.map(c => ({
        checkinId:   c.checkinId,
        beerName:    c.beerName,
        breweryName: c.breweryName,
        style:       c.style,
        abv:         c.abv,
        servingType: c.servingType,
        createdAtMs: parseUntappdDate(c.createdAt),
      })),
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: 'rate limited by Untappd' }, { status: 429 });
    }
    console.error('[/api/sync]', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 503 });
  }
}
