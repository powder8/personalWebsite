import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { getTrainingInsights } from '@/server/insights';
import { InsightsView } from '@/components/InsightsView';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) notFound();
  const insights = await getTrainingInsights(id);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/athletes/${id}`} className="text-sm text-sky-300 hover:underline">
          ← {athlete.fullName}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Insights</h1>
        <p className="text-sm text-slate-500">
          Patterns from {athlete.fullName.split(' ')[0]}’s own training history — observations to
          discuss, not prescriptions.
        </p>
      </div>

      {insights ? (
        <InsightsView insights={insights} />
      ) : (
        <Card>
          <p className="text-sm text-slate-500">
            Not enough training history yet. Insights appear once there’s a meaningful run history
            (connect Strava or import a log).
          </p>
        </Card>
      )}
    </div>
  );
}
