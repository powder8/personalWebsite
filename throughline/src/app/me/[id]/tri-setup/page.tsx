import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { getAthleteWeightKg } from '@/db/powerConfig';
import { TriGoalSetup } from '@/components/TriGoalSetup';
import { BottomNav } from '@/components/BottomNav';

export const dynamic = 'force-dynamic';

/**
 * Triathlon onboarding. Ownership is enforced by the middleware (auth.config.ts
 * pins /me/<uuid> to the signed-in athlete), same as the sibling portal routes.
 */
export default async function TriSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) notFound();
  const weightKg = await getAthleteWeightKg(db, id);
  const firstName = athlete.fullName.split(' ')[0];

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
      <div className="flex items-center gap-3 px-1 pt-3">
        <Link href={`/me/${id}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </Link>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">· Triathlon setup</span>
      </div>

      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 text-white shadow-lg">
        <h1 className="text-2xl font-bold tracking-tight">Let&apos;s build your triathlon, {firstName} 🏊 🚴 🏃</h1>
        <p className="mt-1 text-sm text-white/80">
          Tell me your race, roughly where your fitness is in each sport, and how much you can train. I&apos;ll build a
          coordinated swim/bike/run plan, and give you an honest read on your target.
        </p>
      </div>

      <div className="rounded-3xl bg-[#0f1420] p-6 ring-1 ring-inset ring-white/10">
        <TriGoalSetup athleteId={id} defaultDob={athlete.dateOfBirth} defaultWeightKg={weightKg} />
      </div>

      <BottomNav athleteId={id} />
    </div>
  );
}
