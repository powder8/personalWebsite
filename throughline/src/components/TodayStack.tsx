/**
 * Multi-sport "today" — a triathlete has more than one session on a day (swim +
 * bike + run, sometimes a bike→run brick). The single-focal NextStepBanner can
 * only name one, so when there are several we stack them here: one compact block
 * per discipline, each with its own specific workout (segments + target).
 *
 * A single-sport athlete never reaches this component (the page falls back to
 * NextStepBanner for a 0/1-session day), so running is untouched.
 */
import type { PortalSession } from '@/server/portal';
import { SegmentList } from '@/components/SegmentList';
import { fmtDistance, fmtPace, type Units } from '@/lib/units';

const EMOJI: Record<string, string> = { swim: '🏊', bike: '🚴', run: '🏃' };
// Swim → bike → run: race order, and the order a brick is trained in.
const ORDER: Record<string, number> = { swim: 0, bike: 1, run: 2 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Volume in the discipline's own unit: "2000 m" · "45 min" · "5 mi/km". */
function volumeLabel(s: PortalSession, units: Units): string {
  if (s.discipline === 'bike') return `${Math.round((s.durationSeconds ?? 0) / 60)} min`;
  if (s.discipline === 'swim') return `${Math.round(s.distanceMeters ?? 0)} m`;
  return fmtDistance(s.distanceMeters ?? 0, units);
}

/** Headline target: bike watt band / run pace band / (swim per-100m lives in segments). */
function targetLabel(s: PortalSession, units: Units): string | null {
  if (s.discipline === 'bike') {
    return s.targetPowerLoWatts != null && s.targetPowerHiWatts != null
      ? `${Math.round(s.targetPowerLoWatts)}-${Math.round(s.targetPowerHiWatts)} W`
      : null;
  }
  if (s.discipline === 'swim') return null;
  return s.paceFastSecPerKm != null
    ? `${fmtPace(s.paceFastSecPerKm, units)}-${fmtPace(s.paceSlowSecPerKm ?? s.paceFastSecPerKm, units)}`
    : null;
}

export function TodayStack({ sessions, units }: { sessions: PortalSession[]; units: Units }) {
  const ordered = [...sessions].sort((a, b) => (ORDER[a.discipline] ?? 9) - (ORDER[b.discipline] ?? 9));
  // A bike immediately followed by a run on the same day is a brick (train the
  // run legs off the bike) — flag it so the athlete runs them back-to-back.
  const isBrick = ordered.some((s) => s.discipline === 'bike') && ordered.some((s) => s.discipline === 'run');
  const summary = ordered.map((s) => EMOJI[s.discipline] ?? '•').join(' ');

  return (
    <div className="rounded-3xl bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent p-5 shadow-lg ring-1 ring-inset ring-indigo-400/25">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your next step</div>
      <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold tracking-tight text-white">
        <span aria-hidden>{summary}</span>
        <span>Today: {ordered.length} sessions</span>
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-white/80">
        {isBrick
          ? 'A full day across the sports, the bike and run are a brick, so ride then run straight off the bike.'
          : 'A few sessions today, one per sport. Take them in order and treat each as its own workout.'}
      </p>

      <div className="mt-3 space-y-2.5">
        {ordered.map((s, i) => {
          const target = targetLabel(s, units);
          const brickHere = isBrick && s.discipline === 'run';
          return (
            <div key={s.id} className="rounded-2xl bg-white/5 p-3.5 ring-1 ring-inset ring-white/10">
              <div className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">{EMOJI[s.discipline] ?? '•'}</span>
                <span className="text-sm font-bold text-white">
                  {cap(s.sessionType)} {volumeLabel(s, units)}
                </span>
                {target && <span className="text-sm font-semibold tabular-nums text-white/70">{target}</span>}
                {brickHere && (
                  <span className="rounded bg-indigo-300/20 px-1.5 py-0.5 text-[11px] font-medium text-indigo-200">
                    🔗 off the bike
                  </span>
                )}
                {s.adjustments.length > 0 && (
                  <span className="rounded bg-amber-300/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
                    {s.adjustments.join('; ')}
                  </span>
                )}
              </div>
              {s.segments && s.segments.length > 0 ? (
                <SegmentList segments={s.segments} onDark />
              ) : (
                s.description && <p className="mt-1 text-sm leading-relaxed text-white/85">{s.description}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
