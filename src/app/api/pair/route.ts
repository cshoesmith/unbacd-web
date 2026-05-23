import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { setPin, consumePin, setDevice } from '@/lib/kv';
import { nanoid } from 'nanoid';

/**
 * POST /api/pair
 * Authenticated (browser session required).
 * Generates a short-lived 6-char pairing PIN for the user to enter on their watch.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  // Generate a 6-char alphanumeric PIN (uppercase, easy to type on a watch)
  const pin = nanoid(6).toUpperCase();
  await setPin(pin, session.userId);

  return NextResponse.json({ pin, expiresInSeconds: 600 });
}

/**
 * PUT /api/pair
 * Called by the watch app (no browser session).
 * Body: { pin: string, deviceId: string }
 * Returns: { deviceToken: string } — the watch stores this permanently.
 */
export async function PUT(req: NextRequest) {
  let body: { pin?: string; deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { pin, deviceId } = body;
  if (!pin || !deviceId) {
    return NextResponse.json({ error: 'pin and deviceId are required' }, { status: 400 });
  }

  const userId = await consumePin(String(pin).toUpperCase());
  if (!userId) {
    return NextResponse.json({ error: 'invalid or expired PIN' }, { status: 400 });
  }

  const deviceToken = nanoid(32);
  await setDevice(deviceToken, {
    userId,
    createdAt: Date.now(),
    label: String(deviceId).slice(0, 64),
  });

  return NextResponse.json({ deviceToken });
}
