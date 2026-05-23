import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

const PROXY_BASE   = 'https://utpd-oauth.craftbeers.app';
const BASE_URL     = process.env.NEXT_PUBLIC_BASE_URL!;
const CALLBACK_URL = `${BASE_URL}/api/auth/callback`;

export async function GET() {
  const state = nanoid(16);

  const loginUrl = new URL(`${PROXY_BASE}/login`);
  loginUrl.searchParams.set('next_url', CALLBACK_URL);
  loginUrl.searchParams.set('state',    state);

  const response = NextResponse.redirect(loginUrl.toString());
  // Store state in a short-lived httpOnly cookie for CSRF protection
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   600,
    path:     '/',
  });
  return response;
}
