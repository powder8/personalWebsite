/**
 * Goal tracker hero — the "where do I stand?" hook at the top of the portal.
 * One honest verdict (fitness × execution), the projected outcome vs the goal,
 * and the single lever that moves it. Pure markup; data from server/goalTracker.
 */
import type { GoalTracker, GoalTone } from '@/server/goalTracker';
import type { GoalProgress } from '@/server/goalProgress';
import { TrajectorySparkline } from '@/components/TrajectorySparkline';

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
  at_risk: 'a big reach',
};

export function GoalTrackerHero({ tracker, athleteId, progress }: { tracker: GoalTracker; athleteId: string; progress?: GoalProgress | null }) {
  const t = TONE[tracker.tone];
  return (
    <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-300 ring-1 ring-inset ring-sky-400/25">
              🏃 Run
            </span>
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${t.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${t.fill}`} />
              {VERDICT_LABEL[tracker.verdict]}
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {tracker.raceLine}
            {/* Only show a real DISTANCE here (5K/Half/Marathon…), never a sport
                word like "Bike" — that reads as ambiguous, not as context. */}
            {tracker.distanceLabel && !['run', 'bike', 'swim', 'strength'].includes(tracker.distanceLabel.toLowerCase())
              ? ` · ${tracker.distanceLabel}`
              : ''}
          </p>
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

      {/* The honest "why": what the gap actually is and the runway it needs. */}
      {tracker.gapNote && (
        <p className="mt-3 text-sm leading-relaxed text-white/70">{tracker.gapNote}</p>
      )}

      {/* Trajectory: the fitness trend that decides whether you're closing on it. */}
      {progress && (
        <div className="mt-4 rounded-2xl bg-white/[0.04] p-3.5 ring-1 ring-inset ring-white/10">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">Your trajectory</div>
          <TrajectorySparkline progress={progress} />
        </div>
      )}

      <div className={`mt-4 rounded-2xl p-3.5 ring-1 ring-inset ${t.ring} ${t.bar}`}>
        {tracker.execNote && (
          <div className={`text-xs font-semibold ${t.text}`}>{tracker.execNote}</div>
        )}
        <p className="mt-1 text-sm leading-relaxed text-white/90">{tracker.advocateLine}</p>
        {tracker.outlook && (
          // Collapsed by default so the detail doesn't shout every day; the athlete
          // opens it when they want the full "what it'd take" read. Native <details>
          // → no JS, works in this server component.
          <details className="group mt-3 border-t border-white/10 pt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50 hover:text-white/70">
              <span className="transition group-open:rotate-90">›</span>
              What it’d take, and how we’ll track it
            </summary>
            <dl className="mt-2 space-y-2">
              {(
                [
                  ['What it’d take', tracker.outlook.requirement],
                  ['Check-ins', tracker.outlook.cadence],
                  ['What moves it', tracker.outlook.factors],
                ] as const
              ).map(([term, desc]) => (
                <div key={term}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{term}</dt>
                  <dd className="text-sm leading-relaxed text-white/80">{desc}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {tracker.cta && (
          // Native anchor: a Next <Link> to a bare "#hash" does NOT reliably scroll
          // in the App Router. `#goal-setup` targets the goal editor (which opens
          // itself on that hash — see GoalSetup).
          <a
            href={tracker.cta.href}
            className="mt-2.5 inline-block rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
          >
            {tracker.cta.label}
          </a>
        )}
      </div>
    </div>
  );
}
