/**
 * /me/health — resolves the signed-in athlete's ID from the session and
 * redirects to /me/[id]/health. Lets the top nav use a stable URL without
 * needing to know the athlete ID ahead of time. Mirrors /me/settings.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function MeHealthRedirect() {
  if (!authConfigured()) redirect('/me');

  const session = await auth();
  if (!session?.user?.email) redirect('/signin');

  const db = await getDb();
  const [athlete] = await db
    .select({ id: athletes.id })
    .from(athletes)
    .where(eq(athletes.email, session.user.email.toLowerCase()))
    .limit(1);

  if (!athlete) redirect('/me');
  redirect(`/me/${athlete.id}/health`);
}
