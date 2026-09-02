/**
 * Latest bike / swim / strength session, as a primary card in "how training is
 * going" — the multisport twin of the run debrief. Sport-native stats (cycling
 * speed, swim pace/100m) from latestSessionLogic. Pure markup.
 */
import Link from 'next/link';
import type { LatestSession } from '@/server/latestSessionLogic';
import { buildSessionSummaryView } from '@/server/latestSessionLogic';
import type { Units } from '@/lib/units';

export function SessionSummaryCard({ session, units, athleteId }: { session: LatestSession; units: Units; athleteId?: string }) {
  const view = buildSessionSummaryView(session, units);
  const inner = (
    <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-inset ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base">{view.emoji}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{view.title}</span>
        </div>
        <span className="text-[11px] text-white/40">{view.whenLabel}</span>
      </div>

      {view.stats.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {view.stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-white/[0.03] px-3 py-2 ring-1 ring-inset ring-white/10">
              <div className="text-[10px] font-medium uppercase tracking-wide text-white/40">{s.label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-white/90">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-sm leading-relaxed text-white/70">{view.summary}</p>
      {athleteId && <span className="mt-2 inline-block text-xs font-semibold text-sky-300">See the session →</span>}
    </div>
  );

  return athleteId ? (
    <Link href={`/me/${athleteId}/rides/${session.activityId}`} className="block transition hover:opacity-95">
      {inner}
    </Link>
  ) : (
    inner
  );
}
