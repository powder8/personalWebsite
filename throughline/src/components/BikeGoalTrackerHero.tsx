/**
 * Standalone cycling goal tracker hero — the bike-native "where do I stand?".
 * A RACE finish-time goal (target time on a course with distance + elevation)
 * shows an honest verdict from the elevation-aware model + ceiling; a goal FTP
 * shows the power verdict; otherwise a build-state countdown. Pure markup.
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
  ahead: 'positive', on_track: 'positive', stretch: 'caution', unrealistic: 'caution', beyond_reach: 'risk',
};
const VERDICT_LABEL: Record<FeasibilityVerdict, string> = {
  ahead: 'within reach', on_track: 'on track', stretch: 'a stretch', unrealistic: 'a longer game', beyond_reach: 'beyond reach',
};

function clock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
const km = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
const elev = (m: number) => `${Math.round(m).toLocaleString()} m climbing`;

export function BikeGoalTrackerHero({ tracker, athleteId }: { tracker: BikeGoalTracker; athleteId: string }) {
  const race = tracker.raceGoal;
  const ftp = tracker.ftpGoal;
  const verdict = race?.verdict ?? ftp?.verdict ?? null;
  const tone = verdict ? TONE[VERDICT_TONE[verdict]] : TONE.positive;

  // Headline + note per goal kind.
  let headline: string;
  let sub: React.ReactNode;
  let note: React.ReactNode | null;

  if (race) {
    const target = clock(race.targetTimeSeconds);
    headline =
      race.verdict === 'ahead' ? `${target} is within reach`
      : race.verdict === 'beyond_reach' ? `${target} is faster than this course allows for you`
      : race.verdict === 'unrealistic' ? `${target} is a longer game`
      : race.verdict === 'stretch' ? `${target} is a real stretch`
      : `${target} is on track`;
    sub = (
      <>
        {tracker.distanceMeters != null && <>{km(tracker.distanceMeters)} · </>}
        {tracker.elevationGainMeters != null && tracker.elevationGainMeters > 0 && <>{elev(tracker.elevationGainMeters)} · </>}
        Current FTP <span className="font-semibold tabular-nums text-white/80">{race.currentFtp} W</span>
      </>
    );
    note =
      race.verdict === 'ahead'
        ? `Your FTP already supports ${target} on this course (needs ~${race.requiredFtp} W). Realistic finish on a normal build: ~${clock(race.projectedTimeSeconds)}.`
        : race.aboveCeiling && race.ceiling != null
          ? `On this course ${target} needs about ${race.requiredFtp} W, past what's realistically attainable for your profile (a best-case ceiling ~${race.ceiling} W), even with unlimited time. That's no knock on you. A strong, honest target here is ~${clock(race.projectedTimeSeconds)}. Let's chase that.`
          : `On this course ${target} needs about ${race.requiredFtp} W — from ${race.currentFtp} W that's ~${race.requiredWeeklyGain} W/wk of focused work. Realistic finish on a normal build: ~${clock(race.projectedTimeSeconds)}.`;
  } else if (ftp) {
    headline =
      ftp.verdict === 'ahead' ? `You're already at ${ftp.targetFtp} W`
      : ftp.verdict === 'beyond_reach' ? `${ftp.targetFtp} W is beyond this build`
      : ftp.verdict === 'unrealistic' ? `${ftp.targetFtp} W is a longer game`
      : ftp.verdict === 'stretch' ? `${ftp.targetFtp} W is a real stretch`
      : `${ftp.targetFtp} W is on track`;
    sub = <>Current FTP <span className="font-semibold tabular-nums text-white/80">{ftp.currentFtp} W</span></>;
    note =
      ftp.aboveCeiling && ftp.ceiling != null
        ? `${ftp.targetFtp} W is past what's realistically attainable for your profile (a best-case ceiling ~${ftp.ceiling} W), even with unlimited time. A strong, honest target is ~${ftp.projectedFtp} W by race day.`
        : `From ${ftp.currentFtp} W, ${ftp.targetFtp} W needs about ${ftp.requiredWeeklyGain} W/wk of focused work. Realistic on a normal build: ~${ftp.projectedFtp} W by race day.`;
  } else {
    headline = `Building toward ${tracker.goalName}`;
    sub = <>FTP <span className="font-semibold tabular-nums text-white/80">{tracker.currentFtp} W</span> · no target set yet</>;
    note = null;
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${tone.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${tone.fill}`} />
            🚴 {tracker.goalName}{verdict ? ` · ${VERDICT_LABEL[verdict]}` : ''}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{headline}</h1>
          <p className="mt-1 text-sm text-slate-400">{sub}</p>
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
              Add your race distance, climbing, and a target time — I&apos;ll tell you honestly whether it&apos;s on.
            </p>
            <Link
              href={`/me/${athleteId}/bike-setup`}
              className="mt-2.5 inline-block rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
            >
              Set a target
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
