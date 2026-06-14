import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';

export const dynamic = 'force-dynamic';

/** Athlete entry point: send a signed-in athlete to their own portal. */
export default async function MeIndex() {
  if (!authConfigured()) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-sm text-slate-500">
        Open your portal via your personal link (auth isn’t enabled yet).
      </div>
    );
  }
  const session = await auth();
  if (!session?.user) redirect('/signin?callbackUrl=/me');
  if (session.user.role === 'coach') redirect('/');
  if (session.user.athleteId) {
    // New self-service athlete who hasn't finished onboarding → the wizard.
    const db = await getDb();
    const [a] = await db
      .select({ onboardedAt: athletes.onboardedAt, mode: athletes.coachingMode })
      .from(athletes)
      .where(eq(athletes.id, session.user.athleteId))
      .limit(1);
    if (a && a.mode === 'autonomous' && !a.onboardedAt) redirect('/onboarding');
    redirect(`/me/${session.user.athleteId}`);
  }
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-slate-900">No athlete profile linked yet</h1>
      <p className="mt-2 text-sm text-slate-500">
        Your account isn’t connected to an athlete record. Ask your coach to add you with this email address.
      </p>
    </div>
  );
}
