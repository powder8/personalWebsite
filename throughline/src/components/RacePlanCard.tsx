/**
 * Race plan — Runna-style "estimated time" target window + tune-up race
 * windows with dates, distances, intent, and course/terrain guidance.
 * Pure server markup; data from server/racePlan.ts.
 */
import type { RacePlan } from '@/server/racePlan';

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtShort(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
}

const WINDOW_CHIP: Record<string, string> = {
  final_sharpener: 'bg-violet-50 text-violet-700 ring-violet-200',
  specificity_tuneup: 'bg-rose-50 text-rose-700 ring-rose-200',
  fitness_check: 'bg-amber-50 text-amber-700 ring-amber-200',
  opener: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export function RacePlanCard({ plan }: { plan: RacePlan }) {
  return (
    <div>
      {/* Target window — grounded in current fitness */}
      {plan.target && (
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Your target window · {plan.goal.distanceLabel ?? 'goal race'}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
              {fmtTime(plan.target.stretchSeconds)}
            </span>
            <span className="text-lg font-semibold text-slate-400">–</span>
            <span className="text-3xl font-extrabold tracking-tight text-slate-500 tabular-nums">
              {fmtTime(plan.target.solidSeconds)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {fmtTime(plan.target.solidSeconds)} is what your current fitness (VDOT {plan.target.vdot}) predicts
            today; {fmtTime(plan.target.stretchSeconds)} is in reach with a strong block of training.
            {plan.goal.targetTimeSeconds ? ` Your stated goal: ${fmtTime(plan.goal.targetTimeSeconds)}.` : ''}
          </p>
        </div>
      )}

      {/* Tune-up race windows */}
      {plan.windows.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Warm-up races on the way
          </div>
          <ol className="space-y-2">
            {plan.windows.map((w) => (
              <li key={w.kind} className="rounded-xl border border-slate-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                      WINDOW_CHIP[w.kind] ?? 'bg-slate-50 text-slate-600 ring-slate-200'
                    }`}
                  >
                    {w.label}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-slate-600">
                    {fmtShort(w.fromDate)} – {fmtShort(w.toDate)}
                  </span>
                </div>
                <div className="mt-1.5 text-sm text-slate-700">
                  {w.filledBy ? (
                    <span className="font-medium text-emerald-700">
                      ✓ {w.filledBy.name} · {fmtShort(w.filledBy.date)}
                    </span>
                  ) : (
                    <span>
                      <span className="font-medium">{w.primaryDistance}</span>
                      {w.suggestedDistances.length > 1 && (
                        <span className="text-slate-400"> (or {w.suggestedDistances.slice(1).join(' / ')})</span>
                      )}
                      {w.targetPaceLabel && (
                        <span className="ml-1 text-slate-500">@ ~{w.targetPaceLabel}</span>
                      )}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{w.effortNote}</p>
                <p className="mt-0.5 text-xs text-slate-400">Course: {w.courseProfile}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-400">{plan.goalCourseNote}</p>
    </div>
  );
}
