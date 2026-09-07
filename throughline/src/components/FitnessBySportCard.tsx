/**
 * Per-sport fitness progress. Training load (the PMC) says how MUCH you trained;
 * this says whether you're getting FASTER, using the best measure each sport's
 * data supports. Pure markup; data from server/fitnessProgress.
 */
import type { FitnessProgress, ProgressSport, SportFitness } from '@/server/fitnessProgress';
import { higherIsBetter } from '@/server/fitnessProgressLogic';

const EMOJI: Record<ProgressSport, string> = { run: '🏃', bike: '🚴', swim: '🏊' };
const NAME: Record<ProgressSport, string> = { run: 'Run', bike: 'Bike', swim: 'Swim' };

/** What the number means, in the athlete's language. */
const METRIC_LABEL: Record<SportFitness['metric'], string> = {
  vdot: 'VDOT',
  efficiency: 'Distance per heartbeat',
  swim_pace: 'Pace / 100m',
};
const METRIC_WHY: Record<SportFitness['metric'], string> = {
  vdot: 'From the race-able efforts you actually ran in each period, so it can sit below the anchor your paces come from.',
  efficiency: 'How far you travel per heartbeat. Same ride at a lower heart rate means fitter.',
  swim_pace: 'Your typical pace on real swim sets.',
};

function fmtValue(s: SportFitness): string {
  if (s.current == null) return '-';
  if (s.metric === 'vdot') return s.current.toFixed(1);
  if (s.metric === 'efficiency') return `${s.current.toFixed(2)} m`;
  const total = Math.round(s.current);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Sparkline across the populated periods (oldest → newest). */
function Spark({ sport }: { sport: SportFitness }) {
  const pts = sport.buckets.map((b) => b.value);
  const vals = pts.filter((v): v is number => v != null);
  if (vals.length < 2) return null;

  const W = 96;
  const H = 24;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  // Always draw "better = up", so a falling swim pace still rises on screen.
  const norm = (v: number) => (higherIsBetter(sport.metric) ? (v - min) / span : (max - v) / span);

  const step = pts.length > 1 ? W / (pts.length - 1) : W;
  const d = pts
    .map((v, i) => (v == null ? null : `${i * step},${(H - 2 - norm(v) * (H - 4)).toFixed(1)}`))
    .filter((s): s is string => s !== null)
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${s}`)
    .join(' ');

  const stroke = sport.direction === 'up' ? '#a3e635' : sport.direction === 'down' ? '#fb7185' : '#94a3b8';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-24 shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SportRow({ sport }: { sport: SportFitness }) {
  const tone =
    sport.direction === 'up' ? 'text-lime-300' : sport.direction === 'down' ? 'text-rose-300' : 'text-slate-400';
  const trend =
    sport.deltaPct == null
      ? 'Not enough history yet'
      : sport.direction === 'flat'
        ? 'Holding steady'
        : `${sport.deltaPct > 0 ? '+' : ''}${sport.deltaPct}% over ${sport.buckets.length * 4} weeks`;

  return (
    <div className="rounded-2xl bg-white/5 p-3.5 ring-1 ring-inset ring-white/10">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-base">{EMOJI[sport.sport]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">{NAME[sport.sport]}</div>
          <div className="text-[11px] text-slate-400">{METRIC_LABEL[sport.metric]}</div>
        </div>
        <Spark sport={sport} />
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold tabular-nums text-white">{fmtValue(sport)}</div>
          <div className={`text-[11px] font-medium ${tone}`}>{trend}</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {METRIC_WHY[sport.metric]}
        {sport.vo2max != null && ` That works out to an estimated VO2max of ${sport.vo2max}.`}
      </p>
    </div>
  );
}

export function FitnessBySportCard({ progress }: { progress: FitnessProgress }) {
  if (progress.sports.length === 0) return null;
  const hasBike = progress.sports.some((s) => s.sport === 'bike');

  return (
    <section className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-tight text-white">Fitness by sport</h2>
        <span className="text-[11px] text-slate-500">last {progress.sports[0].buckets.length * 4} weeks</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Are you getting faster, sport by sport? Each is measured the way that sport can honestly be measured.
      </p>
      <div className="mt-3 space-y-2">
        {progress.sports.map((s) => (
          <SportRow key={s.sport} sport={s} />
        ))}
      </div>
      {hasBike && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Cycling has no power data here, so FTP can&apos;t be measured from your rides — update it on your settings
          page and the plan re-tunes. Distance per heartbeat is the honest stand-in in the meantime.
        </p>
      )}
    </section>
  );
}
