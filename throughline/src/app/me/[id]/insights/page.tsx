import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { getTrainingInsights } from '@/server/insights';
import { InsightsView } from '@/components/InsightsView';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Athlete-facing insights — identical analysis the coach sees, in "your" voice. */
export default async function MyInsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) notFound();
  const insights = await getTrainingInsights(id);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/me/${id}`} className="text-sm text-sky-700 hover:underline">
          ← Back
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Your training patterns</h1>
        <p className="text-sm text-slate-500">
          What’s driven your fitness, and what to consider next — from your own history and training
          science.
        </p>
      </div>

      {insights ? (
        <InsightsView insights={insights} />
      ) : (
        <Card>
          <p className="text-sm text-slate-500">
            Not enough training history yet — connect Strava or import a log and your patterns will
            appear here.
          </p>
        </Card>
      )}
    </div>
  );
}
