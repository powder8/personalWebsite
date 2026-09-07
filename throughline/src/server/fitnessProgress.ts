/**
 * Per-sport fitness progress — "am I getting fitter at THIS sport?"
 *
 * Distinct from the PMC (server/fitness.ts), which trends training LOAD: a big
 * month of easy volume raises CTL without making you faster. This trends
 * PERFORMANCE, derived from the activities themselves (nothing extra is stored,
 * so it recomputes honestly as history changes).
 *
 * Per sport we use the best measure the data actually supports:
 *   • run   → VDOT from race-able efforts (shared with the fitness anchor via
 *             scoredRunEfforts, so the trend and the anchor can never disagree).
 *             VDOT is a performance-derived VO2max proxy → also the VO2max read.
 *   • bike  → metres per heartbeat. We store no power, so FTP cannot be derived
 *             from rides; speed-at-HR is the honest proxy.
 *   • swim  → pace per 100 m on quality swims (lower is better).
 */
import { and, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import { activities, dailySummaries } from '@/db/schema';
import { scoredRunEfforts } from '@/server/runEfforts';
import { vo2maxFromVdot } from '@/server/healthLogic';
import {
  buildSportProgress,
  metresPerBeat,
  type ProgressSample,
  type SportProgress,
} from '@/server/fitnessProgressLogic';

export type ProgressSport = 'run' | 'bike' | 'swim';

export interface SportFitness extends SportProgress {
  sport: ProgressSport;
  /**
   * VO2max for this sport: the device-MEASURED number when a wearable reports
   * one (Garmin gives running and cycling separately), otherwise the VDOT-derived
   * estimate for running. Null for swimming, and for cycling with no device
   * number — speed alone can't yield an honest VO2max.
   */
  vo2max: number | null;
  vo2maxSource: 'measured' | 'estimated_vdot' | null;
}

export interface FitnessProgress {
  /** Only sports with at least one qualifying reading. */
  sports: SportFitness[];
}

/** Ignore token sessions — too short to say anything about fitness. */
const MIN_BIKE_METERS = 8000;
const MIN_BIKE_SECONDS = 15 * 60;
const MIN_SWIM_METERS = 400;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function getFitnessProgress(
  db: DB,
  athleteId: string,
  today: string,
  opts: { periodDays?: number; periods?: number } = {},
): Promise<FitnessProgress> {
  const periodDays = opts.periodDays ?? 28;
  const periods = opts.periods ?? 6;
  const windowDays = periodDays * periods;
  const since = new Date(`${addDays(today, -windowDays)}T00:00:00.000Z`);

  // --- run: VDOT per demonstrated effort (same scoring as the anchor) ---
  const runEfforts = await scoredRunEfforts(db, athleteId, { days: windowDays });
  const runSamples: ProgressSample[] = runEfforts.map((e) => ({ day: e.day, value: e.rawVdot }));

  // --- bike + swim: from the activities themselves ---
  const rows = await db
    .select({
      sport: activities.sport,
      startTime: activities.startTime,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
      avgHr: activities.avgHr,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startTime, since)));

  // Device-measured VO2max, most recent in the window, per sport.
  const vo2Rows = await db
    .select({ day: dailySummaries.day, run: dailySummaries.vo2maxRunning, bike: dailySummaries.vo2maxCycling })
    .from(dailySummaries)
    .where(and(eq(dailySummaries.athleteId, athleteId), gte(dailySummaries.day, addDays(today, -windowDays))));
  const latest = (pick: (r: (typeof vo2Rows)[number]) => number | null): number | null => {
    const v = [...vo2Rows].filter((r) => pick(r) != null).sort((a, b) => a.day.localeCompare(b.day)).at(-1);
    return v ? Math.round(pick(v)! * 10) / 10 : null;
  };
  const measuredRun = latest((r) => r.run);
  const measuredBike = latest((r) => r.bike);

  const bikeSamples: ProgressSample[] = [];
  const swimSamples: ProgressSample[] = [];
  for (const r of rows) {
    const day = r.startTime.toISOString().slice(0, 10);
    const m = r.distanceMeters ?? 0;
    const s = r.durationSeconds ?? 0;
    if (r.sport === 'bike') {
      if (m < MIN_BIKE_METERS || s < MIN_BIKE_SECONDS) continue;
      const ef = metresPerBeat({ distanceMeters: m, durationSeconds: s, avgHr: r.avgHr });
      if (ef != null) bikeSamples.push({ day, value: ef });
    } else if (r.sport === 'swim') {
      if (m < MIN_SWIM_METERS || s <= 0) continue;
      swimSamples.push({ day, value: s / (m / 100) }); // sec per 100 m
    }
  }

  const build = (sport: ProgressSport, samples: ProgressSample[], metric: SportProgress['metric']): SportFitness => {
    const p = buildSportProgress(samples, { today, metric, periodDays, periods });
    const measured = sport === 'run' ? measuredRun : sport === 'bike' ? measuredBike : null;
    const estimated = sport === 'run' && p.current != null ? vo2maxFromVdot(p.current) : null;
    return {
      ...p,
      sport,
      vo2max: measured ?? estimated,
      vo2maxSource: measured != null ? 'measured' : estimated != null ? 'estimated_vdot' : null,
    };
  };

  const sports = [
    build('run', runSamples, 'vdot'),
    build('bike', bikeSamples, 'efficiency'),
    build('swim', swimSamples, 'swim_pace'),
  ].filter((s) => s.samples > 0);

  return { sports };
}
