/**
 * Root — placeholder until the public marketing page lands here. Signed-in
 * users go to their home (coach console at /coach, athletes to /me); everyone
 * else goes to sign-in. The upcoming landing page replaces the signed-out path.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  if (!authConfigured()) redirect('/coach'); // local dev without auth

  const session = await auth();
  if (!session?.user) redirect('/signin');
  redirect(session.user.role === 'coach' ? '/coach' : '/me');
}
