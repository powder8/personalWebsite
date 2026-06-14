import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { getAthleteVdot } from '@/db/paceConfig';
import { stravaConfigured } from '@/providers/strava/env';
import { OnboardingWizard } from '@/components/OnboardingWizard';

export const dynamic = 'force-dynamic';

/**
 * Self-service first-run onboarding. Athlete resolved from the session in prod;
 * in local dev (auth off) a ?id= param picks the athlete so the flow is testable.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id: devId } = await searchParams;

  let athleteId: string | null = null;
  if (authConfigured()) {
    const session = await auth();
    if (!session?.user) redirect('/signin?callbackUrl=/onboarding');
    if (session.user.role === 'coach') redirect('/');
    athleteId = session.user.athleteId ?? null;
  } else {
    athleteId = devId ?? null;
  }
  if (!athleteId) redirect('/me');

  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) redirect('/me');

  // Already onboarded → straight to the portal.
  if (athlete.onboardedAt) redirect(`/me/${athlete.id}`);

  const hasAnchor = (await getAthleteVdot(db, athlete.id)) != null;
  const firstName = athlete.fullName.split(' ')[0];

  return (
    <OnboardingWizard
      athleteId={athlete.id}
      firstName={firstName}
      hasAnchor={hasAnchor}
      stravaConfigured={stravaConfigured()}
    />
  );
}
