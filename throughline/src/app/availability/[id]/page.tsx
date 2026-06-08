import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { eq } from 'drizzle-orm';
import { athletes } from '@/db/schema';
import { listActiveDirectives } from '@/server/directives';
import { AvailabilityForm } from '@/components/AvailabilityForm';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Athlete-facing availability page (intended as a magic-link surface). The
 * athlete marks days they can't train; those become rest in their plan.
 */
export default async function AvailabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) notFound();

  const directives = await listActiveDirectives(db, id);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Need to adjust your training?</h1>
        <p className="text-sm text-slate-500">
          Hi {athlete.fullName.split(' ')[0]} — tell your coach when you’re travelling, slammed, or sick and
          what you need (move a workout, lighter mileage, or a rest day). The plan adjusts around it.
        </p>
      </div>

      <Card title="Request an adjustment">
        <AvailabilityForm athleteId={id} />
      </Card>

      <Card title="Currently marked">
        {directives.length ? (
          <ul className="space-y-1 text-sm">
            {directives.map((d) => (
              <li key={d.id} className="text-slate-700">
                {d.from}
                {d.to && d.to !== d.from ? ` → ${d.to}` : ''}
                {d.label ? ` · ${d.label}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Nothing marked — you’re all set.</p>
        )}
      </Card>
    </div>
  );
}
