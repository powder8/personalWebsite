import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { todayISO } from '@/server/console';
import { getHealthSnapshot } from '@/server/health';
import { HealthView } from '@/components/HealthView';
import { BottomNav } from '@/components/BottomNav';

export const dynamic = 'force-dynamic';

/**
 * The athlete's general Health page — a sport-agnostic wellness view of where
 * they stand vs their goals and their age group. Ownership is enforced by the
 * middleware (auth.config.ts pins /me/<uuid> to the signed-in athlete), same as
 * the sibling portal routes; here we only resolve + notFound.
 */
export default async function HealthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const snapshot = await getHealthSnapshot(db, id, todayISO());
  if (!snapshot) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
      <div className="flex items-center gap-3 px-1 pt-3">
        <Link
          href={`/me/${id}`}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to training
        </Link>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">· Health</span>
      </div>

      <div className="px-1">
        <h1 className="text-xl font-semibold text-slate-900">Your health</h1>
        <p className="text-sm text-slate-500">
          Where your fitness and recovery stand — against your own baseline and your age group.
        </p>
      </div>

      <HealthView snapshot={snapshot} />

      <BottomNav athleteId={id} />
    </div>
  );
}
