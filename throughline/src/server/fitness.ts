import 'server-only';
/**
 * Fitness / fatigue (PMC) read model. Computes the Banister CTL/ATL/TSB series
 * from an athlete's activities — the "Performance Management Chart" serious
 * athletes know from TrainingPeaks, but explainable and derived on the fly.
 *
 * Load per activity uses the stored TRIMP when present; otherwise a duration
 * proxy (HR-free imports). Duration is derived from distance × pace when the
 * source log didn't record it. The series is computed over the athlete's full
 * activity history (so CTL is warmed up) and the last `days` are returned.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities } from '@/db/schema';
import { computeFitnessFatigue } from '@/engine/fitnessFatigue';
import { selectDailyLoad, NO_ANCHORS } from '@/engine/loadSelectLogic';
import { getLoadCurrency, resolveAthleteLoadAnchors } from '@/db/loadCurrencyConfig';
import type { DailyReading, FitnessFatiguePoint } from '@/engine/types';

const ASSUMED_EASY_SEC_PER_KM = 330; // ~8:50/mi, used only when pace+duration are both absent

export interface FitnessSeries {
  points: FitnessFatiguePoint[]; // last `days` days, ascending
  current: { ctl: number; atl: number; tsb: number; day: string } | null;
  form: 'fresh' | 'neutral' | 'fatigued' | null; // interpretation of current TSB
  estimated: boolean; // true when load is a duration/volume proxy (no HR/TRIMP)
}

function activityDuration(a: {
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgPaceSecPerKm: number | null;
}): number {
  if (a.durationSeconds != null && a.durationSeconds > 0) return a.durationSeconds;
  const km = (a.distanceMeters ?? 0) / 1000;
  if (km <= 0) return 0;
  return km * (a.avgPaceSecPerKm ?? ASSUMED_EASY_SEC_PER_KM);
}

export async function getFitnessFatigueSeries(athleteId: string, days = 120): Promise<FitnessSeries> {
  const db = await getDb();
  const rows = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      durationSeconds: activities.durationSeconds,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      avgHr: activities.avgHr,
      maxHr: activities.maxHr,
      trainingLoad: activities.trainingLoad,
      trainingLoadTss: activities.trainingLoadTss,
    })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(asc(activities.startTime));

  if (rows.length === 0) {
    return { points: [], current: null, form: null, estimated: true };
  }

  // Flag-gated currency swap (spec L2). DEFAULT 'trimp' ⇒ selectDailyLoad returns
  // the exact legacy value, so this path is byte-identical to before the cutover.
  // Anchors are only resolved for the 'tss' on-the-fly fallback (unbackfilled rows).
  const currency = await getLoadCurrency(db);
  const anchors = currency === 'tss' ? await resolveAthleteLoadAnchors(db, athleteId) : NO_ANCHORS;

  let anyEstimated = false;
  const loads: DailyReading[] = rows.map((r) => {
    const day = r.startTime.toISOString().slice(0, 10);
    const { value, estimated } = selectDailyLoad(
      {
        sport: r.sport,
        durationSeconds: activityDuration(r),
        distanceMeters: r.distanceMeters,
        avgHr: r.avgHr,
        avgPaceSecPerKm: r.avgPaceSecPerKm,
        maxHr: r.maxHr,
        trainingLoad: r.trainingLoad,
        trainingLoadTss: r.trainingLoadTss,
      },
      currency,
      anchors,
    );
    if (estimated) anyEstimated = true;
    return { day, value };
  });

  const from = rows[0].startTime.toISOString().slice(0, 10);
  const to = rows[rows.length - 1].startTime.toISOString().slice(0, 10);
  const full = computeFitnessFatigue(loads, from, to);
  const points = full.slice(-days);
  const last = points[points.length - 1] ?? null;

  return {
    points,
    current: last ? { ctl: last.ctl, atl: last.atl, tsb: last.tsb, day: last.day } : null,
    // FORM THRESHOLDS (TSB > 5 fresh / < −10 fatigued) are kept AS-IS across the
    // currency cutover on purpose. They MUST be recalibrated from the owner's
    // prod diff report (scripts/load-currency-diff.ts, spec §2.3) once the flag
    // flips to 'tss': CTL/ATL/TSB renumber to ~0.6× on real TRIMP data, so these
    // bands need re-picking against the per-athlete TSB distribution. Do NOT
    // invent new numbers here before that diff confirms them.
    form: last ? (last.tsb > 5 ? 'fresh' : last.tsb < -10 ? 'fatigued' : 'neutral') : null,
    estimated: anyEstimated,
  };
}
