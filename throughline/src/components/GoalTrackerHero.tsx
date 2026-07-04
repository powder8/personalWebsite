/**
 * Goal tracker hero — the "where do I stand?" hook at the top of the portal.
 * One honest verdict (fitness × execution), the projected outcome vs the goal,
 * and the single lever that moves it. Pure markup; data from server/goalTracker.
 */
import Link from 'next/link';
import type { GoalTracker, GoalTone } from '@/server/goalTracker';

const TONE: Record<GoalTone, { fill: string; text: string; chip: string; ring: string; bar: string }> = {
  positive: {
    fill: 'bg-emerald-400',
    text: 'text-emerald-300',
    chip: 'text-emerald-300',
    ring: 'ring-emerald-400/25',
    bar: 'bg-emerald-400/15',
  },
  caution: {
    fill: 'bg-amber-400',
    text: 'text-amber-300',
    chip: 'text-amber-300',
    ring: 'ring-amber-400/25',
    bar: 'bg-amber-400/15',
  },
  risk: {
    fill: 'bg-rose-400',
    text: 'text-rose-300',
    chip: 'text-rose-300',
    ring: 'ring-rose-400/25',
    bar: 'bg-rose-400/15',
  },
};

const VERDICT_LABEL: Record<GoalTracker['verdict'], string> = {
  ahead: 'ahead of goal',
  on_track: 'on track',
  stretch: 'a stretch',
  drifting: 'drifting',
  at_risk: 'aim honestly',
};

export function GoalTrackerHero({ tracker, athleteId }: { tracker: GoalTracker; athleteId: string }) {
  const t = TONE[tracker.tone];
  return (
    <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${t.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${t.fill}`} />
            {VERDICT_LABEL[tracker.verdict]}
          </div>
          <p className="mt-2 text-sm text-slate-400">{tracker.raceLine}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white">{tracker.headline}</h1>
          {tracker.projectionLine && <p className="mt-1 text-sm text-slate-400">{tracker.projectionLine}</p>}
        </div>
        {tracker.daysAway != null && (
          <div className="shrink-0 text-right">
            <div className="text-5xl font-extrabold leading-none tracking-tight text-lime-300 tabular-nums">
              {tracker.daysAway}
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">days to go</div>
          </div>
        )}
      </div>

      {/* Progress-to-goal bar: fill = projected outcome, marker = the goal line. */}
      <div className={`relative mt-4 h-2 rounded-full ${t.bar}`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${t.fill}`}
          style={{ width: `${tracker.fillPct}%` }}
        />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-white"
          style={{ left: `${tracker.goalMarkerPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{tracker.leftLabel}</span>
        <span>{tracker.rightLabel}</span>
      </div>

      <div className={`mt-4 rounded-2xl p-3.5 ring-1 ring-inset ${t.ring} ${t.bar}`}>
        {tracker.execNote && (
          <div className={`text-xs font-semibold ${t.text}`}>{tracker.execNote}</div>
        )}
        <p className="mt-1 text-sm leading-relaxed text-white/90">{tracker.advocateLine}</p>
        {tracker.cta && (
          <Link
            href={tracker.cta.href}
            className="mt-2.5 inline-block rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
          >
            {tracker.cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
