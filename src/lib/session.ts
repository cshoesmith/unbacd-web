import type { SessionOptions } from 'iron-session';

export interface SessionData {
  userId?: string;
  username?: string;
  accessToken?: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'unbacd-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
};
