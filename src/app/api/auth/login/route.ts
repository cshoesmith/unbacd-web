import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

const CLIENT_ID    = process.env.UNTAPPD_CLIENT_ID!;
const BASE_URL     = process.env.NEXT_PUBLIC_BASE_URL!;
const CALLBACK_URL = `${BASE_URL}/api/auth/callback`;

export async function GET() {
  const state = nanoid(16);

  const authUrl = new URL('https://untappd.com/oauth/authenticate/');
  authUrl.searchParams.set('client_id',     CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_url',  CALLBACK_URL);

  const response = NextResponse.redirect(authUrl.toString());
  // Store state in a short-lived httpOnly cookie for CSRF protection
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   600,
    path:     '/',
  });
  return response;
}
