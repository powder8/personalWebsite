import 'server-only';
/**
 * 12-week training summary for the athlete dashboard (Heather's feedback): a
 * per-week mileage + elevation chart, and a table of labeled efforts (Strava
 * "Workout" / "Long Run" / "Race"). All read-only aggregation over `activities`.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import { activities } from '@/db/schema';

const MI = 1609.344;
const FT_PER_M = 3.280839895;

export interface WeeklyVolume {
  weekStart: string; // Monday, YYYY-MM-DD
  miles: number;
  elevationFt: number;
  runs: number;
}

/** Strava run workout_type → effort label (2 = long run, 3 = workout, 1 = race). */
export type EffortKind = 'race' | 'workout' | 'long_run';
const WORKOUT_TYPE_LABEL: Record<number, EffortKind> = { 1: 'race', 2: 'long_run', 3: 'workout' };

export interface LabeledEffort {
  id: string;
  day: string;
  name: string | null;
  kind: EffortKind;
  miles: number;
  paceSecPerKm: number | null;
  elevationFt: number;
}

export interface TrainingSummary {
  weeks: WeeklyVolume[];
  efforts: LabeledEffort[]; // most-recent first, within the window
  hasElevation: boolean;
}

/** Monday (UTC) of the ISO week containing `day`, as YYYY-MM-DD. */
function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sun … 6 = Sat
  const back = (dow + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function getTrainingSummary(
  db: DB,
  athleteId: string,
  today: string,
  weeks = 12,
): Promise<TrainingSummary> {
  // Build the contiguous week buckets (oldest → newest), based on `today`.
  const thisMonday = mondayOf(today);
  const firstMonday = addDays(thisMonday, -7 * (weeks - 1));
  const buckets: WeeklyVolume[] = [];
  const index = new Map<string, WeeklyVolume>();
  for (let i = 0; i < weeks; i++) {
    const weekStart = addDays(firstMonday, i * 7);
    const w: WeeklyVolume = { weekStart, miles: 0, elevationFt: 0, runs: 0 };
    buckets.push(w);
    index.set(weekStart, w);
  }

  // Pull runs from the window start onward (a day early to be safe on tz edges).
  const since = new Date(`${firstMonday}T00:00:00.000Z`);
  const rows = await db
    .select({
      id: activities.id,
      startTime: activities.startTime,
      sport: activities.sport,
      name: activities.name,
      workoutType: activities.workoutType,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      elevationGainMeters: activities.elevationGainMeters,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startTime, since)));

  const efforts: LabeledEffort[] = [];
  let hasElevation = false;

  for (const r of rows) {
    if (r.sport !== 'run') continue;
    const day = r.startTime.toISOString().slice(0, 10);
    const weekStart = mondayOf(day);
    const bucket = index.get(weekStart);
    const miles = (r.distanceMeters ?? 0) / MI;
    const elevationFt = (r.elevationGainMeters ?? 0) * FT_PER_M;
    if (r.elevationGainMeters != null) hasElevation = true;
    if (bucket) {
      bucket.miles += miles;
      bucket.elevationFt += elevationFt;
      bucket.runs += 1;
    }
    const kind = r.workoutType != null ? WORKOUT_TYPE_LABEL[r.workoutType] : undefined;
    if (kind) {
      efforts.push({
        id: r.id,
        day,
        name: r.name,
        kind,
        miles,
        paceSecPerKm: r.avgPaceSecPerKm,
        elevationFt,
      });
    }
  }

  for (const w of buckets) {
    w.miles = Math.round(w.miles * 10) / 10;
    w.elevationFt = Math.round(w.elevationFt);
  }
  efforts.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  return { weeks: buckets, efforts, hasElevation };
}
