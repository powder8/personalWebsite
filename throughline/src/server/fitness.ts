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
import { estimateLoad } from '@/engine/load';
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
      durationSeconds: activities.durationSeconds,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      avgHr: activities.avgHr,
      trainingLoad: activities.trainingLoad,
    })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(asc(activities.startTime));

  if (rows.length === 0) {
    return { points: [], current: null, form: null, estimated: true };
  }

  let anyEstimated = false;
  const loads: DailyReading[] = rows.map((r) => {
    const day = r.startTime.toISOString().slice(0, 10);
    if (r.trainingLoad != null && r.trainingLoad > 0) {
      return { day, value: r.trainingLoad };
    }
    const dur = activityDuration(r);
    const { load, estimated } = estimateLoad({
      durationSeconds: dur,
      avgHr: r.avgHr,
      distanceMeters: r.distanceMeters,
    });
    if (estimated) anyEstimated = true;
    return { day, value: load };
  });

  const from = rows[0].startTime.toISOString().slice(0, 10);
  const to = rows[rows.length - 1].startTime.toISOString().slice(0, 10);
  const full = computeFitnessFatigue(loads, from, to);
  const points = full.slice(-days);
  const last = points[points.length - 1] ?? null;

  return {
    points,
    current: last ? { ctl: last.ctl, atl: last.atl, tsb: last.tsb, day: last.day } : null,
    form: last ? (last.tsb > 5 ? 'fresh' : last.tsb < -10 ? 'fatigued' : 'neutral') : null,
    estimated: anyEstimated,
  };
}
