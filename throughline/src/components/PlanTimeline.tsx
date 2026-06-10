/**
 * Season block timeline — the macro "how this plan pushes your fitness" view.
 * A segmented horizontal bar (one segment per periodized block, width ∝ weeks),
 * races pinned as markers, and a "you are here" indicator. Pure server markup.
 */
import type { SeasonTimeline } from '@/server/blocks';

const PHASE_STYLE: Record<string, { bar: string; chip: string; label: string }> = {
  base: { bar: 'bg-sky-400', chip: 'bg-sky-50 text-sky-700 ring-sky-200', label: 'Base' },
  build: { bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'Build' },
  peak: { bar: 'bg-rose-400', chip: 'bg-rose-50 text-rose-700 ring-rose-200', label: 'Peak' },
  taper: { bar: 'bg-violet-400', chip: 'bg-violet-50 text-violet-700 ring-violet-200', label: 'Taper' },
  race: { bar: 'bg-lime-400', chip: 'bg-lime-50 text-lime-700 ring-lime-200', label: 'Race' },
  train: { bar: 'bg-slate-300', chip: 'bg-slate-50 text-slate-600 ring-slate-200', label: 'Train' },
};
const phaseStyle = (p: string) => PHASE_STYLE[p] ?? PHASE_STYLE.train;

function fmtShort(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
}

export function PlanTimeline({ timeline }: { timeline: SeasonTimeline }) {
  const { blocks, totalWeeks, currentWeek, progress } = timeline;

  return (
    <div>
      {/* Segmented block bar with the you-are-here marker */}
      <div className="relative">
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
          {blocks.map((b, i) => (
            <div
              key={i}
              className={`${phaseStyle(b.phase).bar} ${b.current ? '' : 'opacity-50'} h-full`}
              style={{ width: `${(b.weeks / totalWeeks) * 100}%` }}
              title={`${phaseStyle(b.phase).label} · ${b.weeks}w`}
            />
          ))}
        </div>
        <div
          className="absolute -top-1 h-5 w-5 -translate-x-1/2 rounded-full border-[3px] border-white bg-slate-900 shadow"
          style={{ left: `${Math.round(progress * 1000) / 10}%` }}
          aria-label="You are here"
        />
      </div>

      {/* Week ticks */}
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
        <span>{fmtShort(timeline.startDay)}</span>
        {currentWeek != null && (
          <span className="font-semibold text-slate-600">
            Week {currentWeek} of {totalWeeks}
          </span>
        )}
        <span>{fmtShort(timeline.endDay)}</span>
      </div>

      {/* Block detail rows */}
      <ol className="mt-3 space-y-1.5">
        {blocks.map((b, i) => (
          <li
            key={i}
            className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${
              b.current ? 'bg-slate-50 ring-1 ring-inset ring-slate-200' : ''
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${phaseStyle(b.phase).chip}`}
              >
                {phaseStyle(b.phase).label}
              </span>
              <span className="truncate text-slate-600">
                {b.weeks}w · {fmtShort(b.startDay)}–{fmtShort(b.endDay)}
                {b.current && <span className="ml-1.5 font-semibold text-slate-900">← now</span>}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
              {b.races.map((r) => (
                <span key={r.date} className="inline-flex items-center gap-1" title={`${r.name} · ${r.date}`}>
                  <span aria-hidden>{r.priority === 'goal' ? '🏁' : '🎽'}</span>
                  <span className="hidden max-w-28 truncate sm:inline">{r.name}</span>
                </span>
              ))}
              {b.milesMin != null && b.milesMax != null && (
                <span className="tabular-nums">
                  {b.milesMin === b.milesMax ? `${b.milesMax}` : `${b.milesMin}–${b.milesMax}`} mi/wk
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
