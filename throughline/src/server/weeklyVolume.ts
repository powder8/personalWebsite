import 'server-only';
/**
 * 12-week training summary for the athlete dashboard (Heather's feedback): a
 * per-week mileage + elevation chart, and a table of labeled efforts (Strava
 * "Workout" / "Long Run" / "Race"). All read-only aggregation over `activities`.
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '@/db';
import { activities } from '@/db/schema';
import { buildTimeByWeek, type WeekTime } from '@/server/weeklyVolumeLogic';

const MI = 1609.344;
const FT_PER_M = 3.280839895;

export interface CrossTrainingSummary {
  sessions: number;
  minutes: number;
  miles: number;
  sports: string[]; // distinct, e.g. ['bike','swim']
  lastDay: string | null;
}

/**
 * Recent cross-training (bike/swim/strength/etc.) over the last `days`. Surfaced
 * so a ride gets credit for the aerobic work — it builds the engine without the
 * pounding — even though it doesn't feed run-pace fitness.
 */
export async function getRecentCrossTraining(
  db: DB,
  athleteId: string,
  today: string,
  days = 14,
): Promise<CrossTrainingSummary> {
  const sinceDay = new Date(`${today}T00:00:00.000Z`);
  sinceDay.setUTCDate(sinceDay.getUTCDate() - days);
  const rows = await db
    .select({
      sport: activities.sport,
      startTime: activities.startTime,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        gte(activities.startTime, sinceDay),
        lte(activities.startTime, new Date(`${today}T23:59:59.999Z`)),
      ),
    );
  const cross = rows.filter((r) => r.sport !== 'run');
  const sports = [...new Set(cross.map((r) => r.sport))];
  let minutes = 0;
  let miles = 0;
  let lastDay: string | null = null;
  for (const r of cross) {
    minutes += Math.round((r.durationSeconds ?? 0) / 60);
    miles += (r.distanceMeters ?? 0) / MI;
    const day = r.startTime.toISOString().slice(0, 10);
    if (!lastDay || day > lastDay) lastDay = day;
  }
  return { sessions: cross.length, minutes, miles: Math.round(miles * 10) / 10, sports, lastDay };
}

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
  /** Weekly training TIME by sport (minutes) — the cross-sport volume view. */
  timeByWeek: WeekTime[];
  /** Sports with time in the window, canonical order. >1 → show the by-sport view. */
  sports: string[];
}

/** Monday (UTC) of the ISO week containing `day`, as YYYY-MM-DD. */
function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sun ... 6 = Sat
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
      durationSeconds: activities.durationSeconds,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      elevationGainMeters: activities.elevationGainMeters,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startTime, since)));

  const efforts: LabeledEffort[] = [];
  let hasElevation = false;
  // Cross-sport training TIME (all disciplines), for the multisport volume view.
  const timeRows: { weekStart: string; sport: string; minutes: number }[] = [];

  for (const r of rows) {
    timeRows.push({
      weekStart: mondayOf(r.startTime.toISOString().slice(0, 10)),
      sport: r.sport,
      minutes: Math.round((r.durationSeconds ?? 0) / 60),
    });
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

  const { byWeek: timeByWeek, sports } = buildTimeByWeek(
    timeRows,
    buckets.map((b) => b.weekStart),
  );

  return { weeks: buckets, efforts, hasElevation, timeByWeek, sports };
}
