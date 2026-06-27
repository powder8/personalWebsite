/**
 * Post-run debrief: the coach's "what went well / focus next" read, with the
 * grounded signals it noticed (sleep, feel, breaks, terrain). Pure markup; data
 * from server/runDebrief.ts.
 *
 * Optional cross-training summary is rendered at the bottom of the card so it
 * reads as one "recent activity" unit, not two disconnected cards.
 */
import type { RunDebriefResult } from '@/server/runDebrief';
import type { CrossTrainingSummary } from '@/server/weeklyVolume';

const CHIP: Record<string, string> = {
  positive: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30',
  caution: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  context: 'bg-white/10 text-white/80 ring-white/20',
};
const SIGNAL_LABEL: Record<string, string> = {
  showed_up: 'Showed up',
  sleep: 'Sleep',
  feel: 'How you felt',
  stops: 'Breaks',
  terrain: 'Terrain',
  pace: 'Pace',
  distance: 'Distance',
  session: 'Session',
  intervals: 'Intervals',
};
const XT_ICON: Record<string, string> = {
  bike: '🚴',
  swim: '🏊',
  strength: '💪',
  cross_train: '🔁',
  other: '🤸',
};

function recencyLabel(daysAgo: number): string {
  if (daysAgo <= 0) return "Today's run";
  if (daysAgo === 1) return "Yesterday's run";
  return `${daysAgo} days ago`;
}

export function RunDebriefCard({
  debrief,
  daysAgo,
  dayMiles,
  crossTraining,
}: {
  debrief: RunDebriefResult;
  daysAgo?: number;
  /** Total miles logged the same day (shown in the attribution header). */
  dayMiles?: number;
  /** Recent cross-training — shown inline at the bottom so it's not a disconnected card. */
  crossTraining?: CrossTrainingSummary | null;
}) {
  const recency = daysAgo != null ? recencyLabel(daysAgo) : null;
  const milesLabel = dayMiles != null && dayMiles > 0 ? `${dayMiles.toFixed(1)} mi` : null;

  const xtIcons = crossTraining && crossTraining.sessions > 0
    ? crossTraining.sports.map((s) => XT_ICON[s] ?? '🔁').join(' ')
    : null;

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 shadow-lg">
      {/* Attribution header — makes clear what run this evaluates */}
      {recency && (
        <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
          <span className="text-xs font-semibold text-lime-300">{recency}</span>
          {milesLabel && <span className="text-xs text-slate-400">· {milesLabel}</span>}
          {debrief.narrated && <span className="ml-auto text-[10px] text-slate-500">coach's words</span>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Coach&rsquo;s debrief
        </span>
        {!recency && debrief.narrated && (
          <span className="text-[10px] text-slate-500">· in your coach&rsquo;s words</span>
        )}
      </div>
      <h2 className="mt-1 text-xl font-extrabold tracking-tight text-white">{debrief.headline}</h2>

      {/* Signal chips — the grounded facts the coach noticed */}
      {debrief.signals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {debrief.signals.map((s, i) =>
            s.key === 'intervals' ? (
              <span
                key={i}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CHIP[s.polarity]}`}
              >
                {s.fact}
              </span>
            ) : (
              <span
                key={i}
                title={s.fact}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CHIP[s.polarity]}`}
              >
                {SIGNAL_LABEL[s.key] ?? s.key}
              </span>
            )
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div className="rounded-2xl bg-emerald-400/15 p-4 ring-1 ring-inset ring-emerald-400/30">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200">What went well</div>
          <p className="mt-1 text-sm leading-relaxed text-white/90">{debrief.wentWell}</p>
        </div>
        <div className="rounded-2xl bg-amber-400/15 p-4 ring-1 ring-inset ring-amber-400/30">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200">Focus next time</div>
          <p className="mt-1 text-sm leading-relaxed text-white/90">{debrief.focusNext}</p>
        </div>
      </div>

      {/* Cross-training — styled block matching the rest of the debrief */}
      {crossTraining && crossTraining.sessions > 0 && (
        <div className="mt-3 rounded-2xl bg-sky-400/15 p-4 ring-1 ring-inset ring-sky-400/30">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{xtIcons}</span>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-200">
              Cross-training · last 2 weeks
            </div>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-white">
            {crossTraining.sessions} session{crossTraining.sessions === 1 ? '' : 's'}
            {crossTraining.sports.length > 0 && (
              <span className="font-normal text-white/70">
                {' '}· {crossTraining.sports.join(', ')}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-white/60">
            Aerobic work with no running impact — counts toward your streak and weekly load.
          </p>
        </div>
      )}
    </div>
  );
}
