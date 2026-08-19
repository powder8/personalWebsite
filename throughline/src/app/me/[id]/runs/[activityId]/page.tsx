import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, shoes } from '@/db/schema';
import { Card } from '@/components/ui';
import { RouteMap } from '@/components/RouteMap';
import { RunDebriefCard } from '@/components/RunDebriefCard';
import { RunFeedbackPrompt } from '@/components/RunFeedbackPrompt';
import { getRunDebrief, getRunFeedbackReport } from '@/server/runDebrief';
import { secPerKmToMinPerMile, gapFromSplits, type GapSplit } from '@/engine/plan';
import { detectIntervals } from '@/engine/plan/intervalDetection';
import type { LapSeg, IntervalResult } from '@/engine/plan/intervalDetection';

export const dynamic = 'force-dynamic';

interface Split {
  distanceMeters: number;
  durationSeconds: number;
  paceSecPerKm: number | null;
  avgHr: number | null;
  elevDiffMeters: number | null;
}

const MI = 1609.344;
const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};
const paceMi = (secPerKm: number | null) =>
  secPerKm == null ? '-' : `${secPerKmToMinPerMile(secPerKm)}/mi`;
const lapPaceSecPerKm = (lap: LapSeg): number | null =>
  lap.distanceMeters > 0 ? lap.durationSeconds / (lap.distanceMeters / 1000) : null;

function roundToNearest(m: number, to: number) {
  return Math.round(m / to) * to;
}

/** Recompute the effort threshold from laps for per-row classification. */
function buildEffortThreshold(laps: LapSeg[]): number | null {
  const valid = laps.filter((l) => l.distanceMeters > 50 && l.durationSeconds > 5);
  if (valid.length < 4) return null;
  const paces = valid.map((l) => l.durationSeconds / (l.distanceMeters / 1000)).sort((a, b) => a - b);
  const median = paces[Math.floor(paces.length / 2)];
  return median * 0.82;
}

/** Run detail: stats, route map, laps/intervals, and mile splits. */
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; activityId: string }>;
}) {
  const { id, activityId } = await params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id) || !UUID_RE.test(activityId)) notFound();

  const db = await getDb();
  const [run] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.athleteId, id)))
    .limit(1);
  if (!run) notFound();

  let shoeName: string | null = null;
  if (run.shoeId) {
    const [s] = await db.select({ name: shoes.name }).from(shoes).where(eq(shoes.id, run.shoeId)).limit(1);
    shoeName = s?.name ?? null;
  }

  const day = run.startTime.toISOString().slice(0, 10);
  const debrief = await getRunDebrief(id, activityId);
  const feedbackReport = await getRunFeedbackReport(id, activityId);
  const gap = gapFromSplits(run.splits as GapSplit[] | null);
  const miles = run.distanceMeters != null ? run.distanceMeters / MI : null;

  // --- Laps (watch lap button) ---
  const laps = (run.laps as LapSeg[] | null) ?? [];
  const intervalResult: IntervalResult | null = laps.length >= 4 ? detectIntervals(laps) : null;
  const effortThreshold = intervalResult ? buildEffortThreshold(laps) : null;
  const isEffort = (lap: LapSeg) => {
    const p = lapPaceSecPerKm(lap);
    return effortThreshold != null && p != null && p <= effortThreshold;
  };

  // --- Mile splits (GPS computed) ---
  const splits = (run.splits as Split[] | null) ?? [];
  const paces = splits.map((s) => s.paceSecPerKm).filter((p): p is number => p != null);
  const fastest = paces.length ? Math.min(...paces) : null;
  const slowest = paces.length ? Math.max(...paces) : null;
  const barPct = (p: number | null) => {
    if (p == null || fastest == null || slowest == null) return 30;
    if (slowest === fastest) return 85;
    return 35 + 55 * ((slowest - p) / (slowest - fastest));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/me/${id}`} className="text-sm text-sky-300 hover:underline">
        ← Back to your training
      </Link>

      {/* Header stats */}
      <div className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 text-white shadow-lg">
        <p className="text-sm text-slate-400">{day}{shoeName ? ` · ${shoeName}` : ''}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{run.name ?? 'Run'}</h1>
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          <Stat label="Distance" value={miles != null ? `${miles.toFixed(2)} mi` : '-'} />
          <Stat label="Time" value={run.durationSeconds != null ? fmtDur(run.durationSeconds) : '-'} />
          <Stat label="Avg pace" value={paceMi(run.avgPaceSecPerKm)} />
          {gap?.significant && <Stat label="GAP" value={paceMi(gap.gapSecPerKm)} accent />}
          <Stat
            label="Elevation"
            value={run.elevationGainMeters != null ? `${Math.round(run.elevationGainMeters * 3.28084)} ft` : '-'}
          />
          {run.avgHr != null && <Stat label="Avg HR" value={`${run.avgHr} bpm`} />}
          {run.maxHr != null && <Stat label="Max HR" value={`${run.maxHr} bpm`} />}
          {run.cadence != null && <Stat label="Cadence" value={`${run.cadence} spm`} />}
        </div>
        {gap?.significant && (
          <p className="mt-3 text-[11px] text-slate-400">
            GAP (grade-adjusted pace) is your flat-equivalent effort over {Math.round(gap.climbMeters * 3.28084)} ft
            of climb, the fairer read of how hard this run actually was.
          </p>
        )}
      </div>

      {/* Coach's debrief */}
      {debrief && <RunDebriefCard debrief={debrief} />}

      {/* Athlete's own read */}
      <RunFeedbackPrompt athleteId={id} activityId={activityId} existing={feedbackReport} />

      {/* Route */}
      {run.mapPolyline ? (
        <Card title="Route">
          <RouteMap polyline={run.mapPolyline} />
          <p className="mt-2 text-[11px] text-slate-400">
            <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-lime-400" />start</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300" />finish</span>
          </p>
        </Card>
      ) : (
        <Card title="Route">
          <p className="text-sm text-slate-500">No route captured for this run, newly synced runs include it.</p>
        </Card>
      )}

      {/* Intervals section, shown when lap button data forms a bimodal pattern */}
      {intervalResult && laps.length > 0 && (
        <Card
          title={`Intervals · ${intervalResult.repCount} × ~${roundToNearest(intervalResult.repAvgDistMeters, 25)}m`}
        >
          <div className="mb-4 flex flex-wrap gap-4">
            <LapStat label="Avg effort pace" value={paceMi(intervalResult.repAvgPaceSecPerKm)} accent />
            <LapStat
              label="Avg rep dist"
              value={`${roundToNearest(intervalResult.repAvgDistMeters, 25)}m`}
            />
            {intervalResult.recoveryAvgPaceSecPerKm != null && (
              <LapStat label="Avg recovery" value={paceMi(intervalResult.recoveryAvgPaceSecPerKm)} />
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-8 py-1 font-medium">#</th>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 font-medium">Dist</th>
                <th className="py-1 font-medium">Pace</th>
                <th className="py-1 font-medium">Time</th>
                <th className="w-14 py-1 text-right font-medium">HR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {laps.map((lap, i) => {
                const effort = isEffort(lap);
                const dist = lap.distanceMeters;
                const distLabel = dist < MI * 0.9
                  ? `${Math.round(dist)}m`
                  : `${(dist / MI).toFixed(2)} mi`;
                return (
                  <tr key={i} className={effort ? 'bg-lime-400/5' : ''}>
                    <td className="py-1.5 text-xs tabular-nums text-slate-400">{i + 1}</td>
                    <td className="py-1.5">
                      {effort ? (
                        <span className="rounded-full bg-lime-400/20 px-2 py-0.5 text-[10px] font-semibold text-lime-300">
                          Effort
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">Rest</span>
                      )}
                    </td>
                    <td className="py-1.5 text-xs tabular-nums text-slate-300">{distLabel}</td>
                    <td className="py-1.5 text-xs font-semibold tabular-nums text-slate-200">
                      {paceMi(lapPaceSecPerKm(lap))}
                    </td>
                    <td className="py-1.5 text-xs tabular-nums text-slate-400">
                      {fmtDur(lap.durationSeconds)}
                    </td>
                    <td className="py-1.5 text-right text-xs tabular-nums text-slate-400">
                      {lap.avgHr ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Fitness interpretation */}
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {intervalResult.workRestRatioTime != null && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Work:rest</div>
                  <div className="text-sm font-bold text-slate-200">
                    1:{(1 / intervalResult.workRestRatioTime).toFixed(1)}
                    <span className="ml-1 text-xs font-normal text-slate-500">by time</span>
                  </div>
                </div>
              )}
              {intervalResult.paceFadePct != null && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Consistency</div>
                  <div className={`text-sm font-bold ${Math.abs(intervalResult.paceFadePct) <= 3 ? 'text-lime-300' : intervalResult.paceFadePct > 0 ? 'text-amber-300' : 'text-lime-300'}`}>
                    {intervalResult.paceFadePct > 0
                      ? `+${intervalResult.paceFadePct}% fade`
                      : intervalResult.paceFadePct < 0
                        ? `${Math.abs(intervalResult.paceFadePct)}% neg. split`
                        : 'held'}
                  </div>
                </div>
              )}
              {intervalResult.recoveryType && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Recovery</div>
                  <div className="text-sm font-bold capitalize text-slate-200">{intervalResult.recoveryType}</div>
                </div>
              )}
            </div>
            {intervalResult.recoveryType && (
              <p className="text-[11px] leading-relaxed text-slate-400">
                {intervalResult.recoveryType === 'walk'
                  ? 'Walking recovery = near-complete rest between reps. This targets neuromuscular speed and power, each rep starts fresh.'
                  : intervalResult.recoveryType === 'jog'
                    ? 'Jogging recovery keeps aerobic demand up between reps, the defining feature of VO2max work. The body learns to clear lactate and repeat near-maximal efforts.'
                    : 'Float recovery is short and demanding, the system never fully restores before the next rep. This targets lactate threshold and is closer to tempo physiology than classic speed work.'}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Laps, shown when lap button data exists but no bimodal interval pattern */}
      {!intervalResult && laps.length >= 2 && (
        <Card title={`Laps · ${laps.length}`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-8 py-1 font-medium">#</th>
                <th className="py-1 font-medium">Dist</th>
                <th className="py-1 font-medium">Pace</th>
                <th className="py-1 font-medium">Time</th>
                <th className="w-14 py-1 text-right font-medium">HR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {laps.map((lap, i) => {
                const dist = lap.distanceMeters;
                const distLabel = dist < MI * 0.9
                  ? `${Math.round(dist)}m`
                  : `${(dist / MI).toFixed(2)} mi`;
                return (
                  <tr key={i}>
                    <td className="py-1.5 text-xs tabular-nums text-slate-400">{i + 1}</td>
                    <td className="py-1.5 text-xs tabular-nums text-slate-300">{distLabel}</td>
                    <td className="py-1.5 text-xs font-semibold tabular-nums text-slate-200">
                      {paceMi(lapPaceSecPerKm(lap))}
                    </td>
                    <td className="py-1.5 text-xs tabular-nums text-slate-400">
                      {fmtDur(lap.durationSeconds)}
                    </td>
                    <td className="py-1.5 text-right text-xs tabular-nums text-slate-400">
                      {lap.avgHr ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Mile splits (GPS computed) */}
      <Card title={splits.length ? 'Mile splits' : 'Splits'}>
        {splits.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-10 py-1 font-medium">Mi</th>
                <th className="py-1 font-medium">Pace</th>
                <th className="w-20 py-1 text-right font-medium">Elev</th>
                <th className="w-16 py-1 text-right font-medium">HR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {splits.map((s, i) => (
                <tr key={i}>
                  <td className="py-1.5 font-medium tabular-nums text-slate-500">
                    {s.distanceMeters < MI * 0.9 ? (s.distanceMeters / MI).toFixed(1) : i + 1}
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-4 rounded ${s.paceSecPerKm != null && s.paceSecPerKm === fastest ? 'bg-lime-400' : 'bg-indigo-400'}`}
                        style={{ width: `${barPct(s.paceSecPerKm)}%` }}
                      />
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-300">
                        {paceMi(s.paceSecPerKm)}
                      </span>
                    </div>
                  </td>
                  <td className="py-1.5 text-right text-xs tabular-nums text-slate-500">
                    {s.elevDiffMeters != null
                      ? `${s.elevDiffMeters >= 0 ? '+' : ''}${Math.round(s.elevDiffMeters * 3.28084)} ft`
                      : '-'}
                  </td>
                  <td className="py-1.5 text-right text-xs tabular-nums text-slate-500">{s.avgHr ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">
            No splits yet, they arrive with newly synced runs. The fastest mile glows lime.
          </p>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums tracking-tight ${accent ? 'text-lime-300' : ''}`}>{value}</div>
    </div>
  );
}

function LapStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-base font-bold tabular-nums ${accent ? 'text-lime-300' : 'text-slate-200'}`}>{value}</div>
    </div>
  );
}
