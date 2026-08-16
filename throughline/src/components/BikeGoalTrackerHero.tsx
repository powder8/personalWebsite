/**
 * Standalone cycling goal tracker hero — the bike-native "where do I stand?".
 * With a goal FTP it shows an honest verdict (on track / a longer game / beyond
 * reach) from the shared feasibility core + attainability ceiling; without one,
 * a build-state countdown that nudges the athlete to set a goal FTP. Pure markup.
 */
import Link from 'next/link';
import type { FeasibilityVerdict } from '@/engine/plan';
import type { BikeGoalTracker } from '@/server/bikeGoalTracker';

const TONE: Record<'positive' | 'caution' | 'risk', { fill: string; text: string; ring: string; bar: string }> = {
  positive: { fill: 'bg-emerald-400', text: 'text-emerald-300', ring: 'ring-emerald-400/25', bar: 'bg-emerald-400/15' },
  caution: { fill: 'bg-amber-400', text: 'text-amber-300', ring: 'ring-amber-400/25', bar: 'bg-amber-400/15' },
  risk: { fill: 'bg-rose-400', text: 'text-rose-300', ring: 'ring-rose-400/25', bar: 'bg-rose-400/15' },
};
const VERDICT_TONE: Record<FeasibilityVerdict, keyof typeof TONE> = {
  ahead: 'positive',
  on_track: 'positive',
  stretch: 'caution',
  unrealistic: 'caution',
  beyond_reach: 'risk',
};
const VERDICT_LABEL: Record<FeasibilityVerdict, string> = {
  ahead: 'at goal power',
  on_track: 'on track',
  stretch: 'a stretch',
  unrealistic: 'a longer game',
  beyond_reach: 'beyond reach',
};

export function BikeGoalTrackerHero({ tracker, athleteId }: { tracker: BikeGoalTracker; athleteId: string }) {
  const a = tracker.assessment;
  const tone = a ? TONE[VERDICT_TONE[a.verdict]] : TONE.positive;

  const headline = !a
    ? `Building toward ${tracker.goalName}`
    : a.verdict === 'ahead'
      ? `You're already at ${a.targetFtp} W`
      : a.verdict === 'beyond_reach'
        ? `${a.targetFtp} W is beyond this build`
        : a.verdict === 'unrealistic'
          ? `${a.targetFtp} W is a longer game`
          : a.verdict === 'stretch'
            ? `${a.targetFtp} W is a real stretch`
            : `${a.targetFtp} W is on track`;

  const note = !a
    ? null
    : a.verdict === 'ahead'
      ? `Your FTP already meets ${a.targetFtp} W — the plan is about sharpening and holding it. Aim a little higher if you want.`
      : a.aboveCeiling && a.ceiling != null
        ? `${a.targetFtp} W is past what's realistically attainable for your profile (a best-case ceiling around ${a.ceiling} W), even with unlimited time — no knock on you, it's simply a big number. A strong, honest target is ~${a.projectedFtp} W by race day. Let's build to that.`
        : a.verdict === 'unrealistic'
          ? `${a.targetFtp} W is reachable, just not in this build: from ${a.currentFtp} W it needs about ${a.gapWatts} W more (~${a.requiredWeeklyGain} W/wk). Give it another block or two — for this event, ~${a.projectedFtp} W is a strong, honest target.`
          : `From ${a.currentFtp} W, ${a.targetFtp} W needs about ${a.requiredWeeklyGain} W/wk of focused work. Realistic on a normal build: ~${a.projectedFtp} W by race day.`;

  return (
    <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${tone.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${tone.fill}`} />
            🚴 {tracker.goalName}{a ? ` · ${VERDICT_LABEL[a.verdict]}` : ''}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{headline}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {a ? (
              <>Current FTP <span className="font-semibold tabular-nums text-white/80">{a.currentFtp} W</span></>
            ) : (
              <>FTP <span className="font-semibold tabular-nums text-white/80">{tracker.currentFtp} W</span> · no goal FTP set yet</>
            )}
          </p>
        </div>
        {tracker.daysAway >= 0 && (
          <div className="shrink-0 text-right">
            <div className="text-5xl font-extrabold leading-none tracking-tight text-lime-300 tabular-nums">{tracker.daysAway}</div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">days to go</div>
          </div>
        )}
      </div>

      <div className={`mt-4 rounded-2xl p-3.5 ring-1 ring-inset ${tone.ring} ${tone.bar}`}>
        {note ? (
          <p className="text-sm leading-relaxed text-white/90">{note}</p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-white/90">
              Set a goal FTP and I&apos;ll show you exactly whether you&apos;re on track to hit it — not just building blind.
            </p>
            <Link
              href={`/me/${athleteId}/bike-setup`}
              className="mt-2.5 inline-block rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
            >
              Set a goal FTP
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
