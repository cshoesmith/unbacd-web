import { NextRequest, NextResponse } from 'next/server';
import { cookies }                   from 'next/headers';
import { getIronSession }            from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  await session.destroy();
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_BASE_URL!));
}
