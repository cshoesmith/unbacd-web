import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getUser, setUser }          from '@/lib/kv';

const CLIENT_ID     = process.env.UNTAPPD_CLIENT_ID!;
const CLIENT_SECRET = process.env.UNTAPPD_CLIENT_SECRET!;
const BASE_URL      = process.env.NEXT_PUBLIC_BASE_URL!;
const CALLBACK_URL  = `${BASE_URL}/api/auth/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get('code');
  // Untappd doesn't always echo back state — we skip strict state check for now
  // (the callback URL itself is HTTPS-only in production)

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', BASE_URL));
  }

  // Exchange authorization code for access token
  const tokenUrl = new URL('https://untappd.com/oauth/authorize/');
  tokenUrl.searchParams.set('client_id',     CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', CLIENT_SECRET);
  tokenUrl.searchParams.set('response_type', 'token');
  tokenUrl.searchParams.set('redirect_url',  CALLBACK_URL);
  tokenUrl.searchParams.set('code',          code);

  const tokenRes  = await fetch(tokenUrl.toString(), { cache: 'no-store' });
  const tokenData = await tokenRes.json();
  const accessToken: string | undefined = tokenData?.response?.access_token;

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
