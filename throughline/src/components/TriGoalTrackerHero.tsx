/**
 * Multi-sport goal tracker hero — the triathlon twin of GoalTrackerHero. One
 * honest verdict for the target finish, the target vs. the realistic finish, and
 * a per-leg breakdown that names the BINDING sport (the leg deciding the day).
 * Pure markup; data from server/triGoalTracker.
 */
import type { Discipline } from '@/engine/plan';
import type { TriGoalTracker } from '@/server/triGoalTracker';
import type { FeasibilityVerdict } from '@/engine/plan';

const TONE: Record<'positive' | 'caution' | 'risk', { fill: string; text: string; ring: string; bar: string }> = {
  positive: { fill: 'bg-emerald-400', text: 'text-emerald-300', ring: 'ring-emerald-400/25', bar: 'bg-emerald-400/15' },
  caution: { fill: 'bg-amber-400', text: 'text-amber-300', ring: 'ring-amber-400/25', bar: 'bg-amber-400/15' },
  risk: { fill: 'bg-rose-400', text: 'text-rose-300', ring: 'ring-rose-400/25', bar: 'bg-rose-400/15' },
};

const VERDICT_TONE: Record<FeasibilityVerdict, keyof typeof TONE> = {
  ahead: 'positive',
  on_track: 'positive',
  stretch: 'caution',
  unrealistic: 'caution', // possible, but a longer game
  beyond_reach: 'risk',
};
const VERDICT_LABEL: Record<FeasibilityVerdict, string> = {
  ahead: 'within reach',
  on_track: 'on track',
  stretch: 'a stretch',
  unrealistic: 'a longer game',
  beyond_reach: 'beyond reach',
};

const EMOJI: Record<Discipline, string> = { swim: '🏊', bike: '🚴', run: '🏃' };
const NAME: Record<Discipline, string> = { swim: 'Swim', bike: 'Bike', run: 'Run' };
const ORDER: Discipline[] = ['swim', 'bike', 'run'];

function clock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Anchor in its native unit: swim m/s · bike W · run VDOT. */
function anchor(d: Discipline, v: number): string {
  if (d === 'swim') return `${v.toFixed(2)} m/s`;
  if (d === 'bike') return `${Math.round(v)} W`;
  return `${v.toFixed(1)} VDOT`;
}

export function TriGoalTrackerHero({ tracker }: { tracker: TriGoalTracker }) {
  const f = tracker.feasibility;
  const t = TONE[VERDICT_TONE[f.verdict]];

  return (
    <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${t.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${t.fill}`} />
            {tracker.goalName} · {VERDICT_LABEL[f.verdict]}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{f.headline}</h1>
          <p className="mt-1 text-sm text-slate-400">
            Target <span className="font-semibold tabular-nums text-white/80">{clock(f.targetFinishSeconds)}</span>
            {' · '}realistic on a normal build{' '}
            <span className={`font-semibold tabular-nums ${t.text}`}>~{clock(f.realisticFinishSeconds)}</span>
          </p>
        </div>
        {tracker.daysAway >= 0 && (
          <div className="shrink-0 text-right">
            <div className="text-5xl font-extrabold leading-none tracking-tight text-lime-300 tabular-nums">
              {tracker.daysAway}
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">days to go</div>
          </div>
        )}
      </div>

      {/* Per-leg breakdown, current → required anchor, with the binding leg flagged. */}
      <div className="mt-4 space-y-2">
        {ORDER.map((d) => {
          const leg = f.legs[d];
          const lt = TONE[VERDICT_TONE[leg.verdict]];
          // When everything's within reach there's no limiter to flag.
          const binding = d === f.bindingLeg && f.verdict !== 'ahead';
          return (
            <div
              key={d}
              className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 ring-1 ring-inset ${
                binding ? `${lt.bar} ${lt.ring}` : 'bg-white/5 ring-white/10'
              }`}
            >
              <span aria-hidden className="text-base">{EMOJI[d]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  {NAME[d]}
                  {binding && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${lt.text} ${lt.bar}`}>
                      limiter
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 tabular-nums">
                  {leg.gap <= 0 ? (
                    <>at {anchor(d, leg.currentAnchor)}, already fast enough</>
                  ) : leg.aboveCeiling && leg.ceiling != null ? (
                    <>
                      {anchor(d, leg.currentAnchor)} → {anchor(d, leg.goalAnchor)} · above your ~{anchor(d, leg.ceiling)} ceiling
                    </>
                  ) : (
                    <>
                      {anchor(d, leg.currentAnchor)} → {anchor(d, leg.goalAnchor)} · {leg.requiredWeeklyGainLabel}
                    </>
                  )}
                </div>
              </div>
              <span className={`h-2 w-2 shrink-0 rounded-full ${lt.fill}`} title={leg.verdict} />
            </div>
          );
        })}
      </div>

      {/* The honest "why", what the binding leg needs, and the realistic finish. */}
      <div className={`mt-4 rounded-2xl p-3.5 ring-1 ring-inset ${t.ring} ${t.bar}`}>
        <p className="text-sm leading-relaxed text-white/90">{f.note}</p>
      </div>
    </div>
  );
}
