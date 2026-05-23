import { cookies }        from 'next/headers';
import { redirect }      from 'next/navigation';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { getBacCache, getUser } from '@/lib/kv';
import DashboardClient   from './DashboardClient';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (!session.userId) {
    redirect('/login');
  }

  const [user, bacCache] = await Promise.all([
    getUser(session.userId),
    getBacCache(session.userId),
  ]);

  return (
    <DashboardClient
      username={session.username ?? user?.username ?? ''}
      weightKg={user?.weightKg ?? 80}
      gender={user?.gender ?? 'male'}
      initialBac={bacCache?.bac ?? null}
      initialSoberMs={bacCache?.soberMs ?? null}
      initialDrinkCount={bacCache?.drinkCount ?? null}
      initialCalculatedAt={bacCache?.calculatedAt ?? null}
      initialCheckins={bacCache?.checkins ?? []}
    />
  );
}
