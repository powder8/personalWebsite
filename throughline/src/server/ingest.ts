/**
 * Persist a provider's NormalizedBatch into the derived tables. Idempotent:
 * upserts on natural keys so replaying the same raw event reproduces identical
 * state. Shared by the async normalizer (Inngest) and the Strava pull sync, so
 * there is ONE place that knows how a batch lands in the DB.
 */
import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  activities,
  dailySummaries,
  sleepRecords,
  hrvRecords,
  restingHrRecords,
} from '@/db/schema';
import type { NormalizedBatch, ProviderId } from '@/providers/types';
import { getDefaultShoeId } from '@/server/shoes';
import { isSameWorkout, isThinProvider, LOOKBACK_SEC, THIN_PROVIDERS, workoutEndMs, type WorkoutKey } from '@/server/workoutDedupLogic';

export async function persistNormalizedBatch(
  db: DB,
  athleteId: string,
  rawEventId: string | null,
  batch: NormalizedBatch,
  provider: ProviderId,
): Promise<void> {
  // Tag every derived row with its source provider so we can dedup / pick a
  // source-of-truth across providers later (e.g. Garmin vs Strava vs Apple).
  const common = { athleteId, rawEventId, provider };

  if (batch.activities?.length) {
    // Auto-assign new runs to the athlete's active default shoe. On re-sync the
    // upsert `set` below omits shoe_id, so an athlete's per-activity override is
    // never clobbered.
    const defaultShoeId = await getDefaultShoeId(db, athleteId);
    await db
      .insert(activities)
      .values(
        batch.activities.map((a) => ({
          ...a,
          ...common,
          shoeId: a.sport === 'run' ? defaultShoeId : null,
        })),
      )
      .onConflictDoUpdate({
        target: activities.sourceRef,
        // Per-row from EXCLUDED: a batch can carry many activities (a device or
        // Whoop push), so each conflicting row must take its OWN incoming values.
        set: {
          name: sql`excluded.name`,
          distanceMeters: sql`excluded.distance_meters`,
          durationSeconds: sql`excluded.duration_seconds`,
          elapsedSeconds: sql`excluded.elapsed_seconds`,
          surface: sql`excluded.surface`,
          avgHr: sql`excluded.avg_hr`,
          maxHr: sql`excluded.max_hr`,
          avgPaceSecPerKm: sql`excluded.avg_pace_sec_per_km`,
          cadence: sql`excluded.cadence`,
          sport: sql`excluded.sport`,
          elevationGainMeters: sql`excluded.elevation_gain_meters`,
          workoutType: sql`excluded.workout_type`,
          // Splits/route only come from DETAIL fetches (webhook); list-based
          // re-syncs send null — never let them wipe data we already captured.
          splits: sql`coalesce(excluded.splits, ${activities.splits})`,
          mapPolyline: sql`coalesce(excluded.map_polyline, ${activities.mapPolyline})`,
        },
      });
    if (!isThinProvider(provider)) {
      await supersedeDeviceWorkouts(db, athleteId, batch.activities);
    }
  }
  if (batch.dailySummaries?.length) {
    await db
      .insert(dailySummaries)
      .values(batch.dailySummaries.map((d) => ({ ...d, ...common })))
      .onConflictDoUpdate({
        target: [dailySummaries.athleteId, dailySummaries.day],
        // Update per-row from EXCLUDED, and coalesce so one provider's null (e.g.
        // Apple sends steps but no stress) never wipes another's value for the day.
        set: {
          steps: sql`coalesce(excluded.steps, ${dailySummaries.steps})`,
          restingHr: sql`coalesce(excluded.resting_hr, ${dailySummaries.restingHr})`,
          avgStressLevel: sql`coalesce(excluded.avg_stress_level, ${dailySummaries.avgStressLevel})`,
          bodyBatteryLow: sql`coalesce(excluded.body_battery_low, ${dailySummaries.bodyBatteryLow})`,
          bodyBatteryHigh: sql`coalesce(excluded.body_battery_high, ${dailySummaries.bodyBatteryHigh})`,
          vo2maxRunning: sql`coalesce(excluded.vo2max_running, ${dailySummaries.vo2maxRunning})`,
          vo2maxCycling: sql`coalesce(excluded.vo2max_cycling, ${dailySummaries.vo2maxCycling})`,
          weightKg: sql`coalesce(excluded.weight_kg, ${dailySummaries.weightKg})`,
          bodyFatPct: sql`coalesce(excluded.body_fat_pct, ${dailySummaries.bodyFatPct})`,
          bmi: sql`coalesce(excluded.bmi, ${dailySummaries.bmi})`,
          metrics: sql`coalesce(excluded.metrics, ${dailySummaries.metrics})`,
        },
      });
  }
  if (batch.sleepRecords?.length) {
    await db
      .insert(sleepRecords)
      .values(batch.sleepRecords.map((s) => ({ ...s, ...common })))
      .onConflictDoNothing({ target: [sleepRecords.athleteId, sleepRecords.day] });
  }
  if (batch.hrvRecords?.length) {
    await db
      .insert(hrvRecords)
      .values(batch.hrvRecords.map((h) => ({ ...h, ...common })))
      .onConflictDoNothing({ target: [hrvRecords.athleteId, hrvRecords.day] });
  }
  if (batch.restingHrRecords?.length) {
    await db
      .insert(restingHrRecords)
      .values(batch.restingHrRecords.map((r) => ({ ...r, ...common })))
      .onConflictDoNothing({ target: [restingHrRecords.athleteId, restingHrRecords.day] });
  }
}

/** Activities in the window that could overlap any of `keys` (pure filtering happens after). */
function overlapWindow(keys: WorkoutKey[]): { from: Date; to: Date } {
  const starts = keys.map((k) => k.startTime.getTime());
  const ends = keys.map((k) => workoutEndMs(k) ?? k.startTime.getTime());
  return { from: new Date(Math.min(...starts) - LOOKBACK_SEC * 1000), to: new Date(Math.max(...ends)) };
}

/**
 * Cross-source dedup, richer-source side: when Strava/Garmin land an activity
 * that a thin source (HealthKit, Health Connect, Whoop) already holds, the thin
 * copy yields. The thin-side check (skip what another source already has) is
 * dropAlreadyRecorded; between them, order of arrival stops mattering.
 */
export async function supersedeDeviceWorkouts(db: DB, athleteId: string, written: WorkoutKey[]): Promise<number> {
  if (written.length === 0) return 0;
  const { from, to } = overlapWindow(written);
  const thinRows = await db
    .select({
      id: activities.id,
      sport: activities.sport,
      startTime: activities.startTime,
      durationSeconds: activities.durationSeconds,
      elapsedSeconds: activities.elapsedSeconds,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        inArray(activities.provider, [...THIN_PROVIDERS]),
        gte(activities.startTime, from),
        lte(activities.startTime, to),
      ),
    );
  const doomed = thinRows.filter((d) => written.some((w) => isSameWorkout(d, w))).map((d) => d.id);
  if (doomed.length === 0) return 0;
  await db.delete(activities).where(inArray(activities.id, doomed));
  return doomed.length;
}

/**
 * Thin-source side: drop incoming workouts that ANOTHER source already
 * recorded (the ride Strava has, the run the watch pushed). Re-syncs of the
 * source's own rows pass through and upsert on sourceRef.
 */
export async function dropAlreadyRecorded<T extends WorkoutKey>(
  db: DB,
  athleteId: string,
  provider: ProviderId,
  list: T[],
): Promise<{ kept: T[]; deduped: number }> {
  if (list.length === 0) return { kept: [], deduped: 0 };
  const { from, to } = overlapWindow(list);
  const existing = await db
    .select({
      sport: activities.sport,
      startTime: activities.startTime,
      durationSeconds: activities.durationSeconds,
      elapsedSeconds: activities.elapsedSeconds,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        ne(activities.provider, provider),
        gte(activities.startTime, from),
        lte(activities.startTime, to),
      ),
    );
  const kept = list.filter((a) => !existing.some((e) => isSameWorkout(a, e)));
  return { kept, deduped: list.length - kept.length };
}
