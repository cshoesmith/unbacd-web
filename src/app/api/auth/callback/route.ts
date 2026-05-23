import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getUser, setUser }          from '@/lib/kv';

const PROXY_BASE = 'https://utpd-oauth.craftbeers.app';
const BASE_URL   = process.env.NEXT_PUBLIC_BASE_URL!;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const tokenCode    = searchParams.get('token_code');
  const returnedState = searchParams.get('state');
  const cookieState  = req.cookies.get('oauth_state')?.value;

  if (!tokenCode) {
    return NextResponse.redirect(new URL('/login?error=missing_code', BASE_URL));
  }

  // CSRF state check (state is optional on the proxy but we always set it)
  if (cookieState && returnedState && returnedState !== cookieState) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', BASE_URL));
  }

  // Exchange token_code for real Untappd access token via proxy
  const exchangeRes = await fetch(`${PROXY_BASE}/get-token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify({ token_code: tokenCode }),
    cache:   'no-store',
  });
  const exchangeData = await exchangeRes.json();
  const accessToken: string | undefined = exchangeData?.access_token;

  if (!accessToken) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', BASE_URL));
  }

  // Fetch Untappd user profile
  const profileRes  = await fetch(
    `https://api.untappd.com/v4/user/info?access_token=${accessToken}`,
    { cache: 'no-store' },
  );
  const profileData = await profileRes.json();
  const username: string = profileData?.response?.user?.user_name ?? 'unknown';
  const userId = `untappd:${username}`;

  // Upsert user record (preserve weight/gender if already configured)
  const existing = await getUser(userId);
  await setUser(userId, {
    untappdToken: accessToken,
    username,
    weightKg: existing?.weightKg ?? 80,
    gender:   existing?.gender   ?? 'male',
  });

  // Create encrypted session cookie
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  session.userId      = userId;
  session.accessToken = accessToken;
  session.username    = username;
  await session.save();

  const response = NextResponse.redirect(new URL('/dashboard', BASE_URL));
  response.cookies.delete('oauth_state');
  return response;
}
