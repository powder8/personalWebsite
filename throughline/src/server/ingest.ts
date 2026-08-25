/**
 * Persist a provider's NormalizedBatch into the derived tables. Idempotent:
 * upserts on natural keys so replaying the same raw event reproduces identical
 * state. Shared by the async normalizer (Inngest) and the Strava pull sync, so
 * there is ONE place that knows how a batch lands in the DB.
 */
import { sql } from 'drizzle-orm';
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

  // Both callers emit a single-activity batch per raw event, so the upsert `set`
  // below safely references batch.activities[0].
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
        set: {
          name: batch.activities[0].name,
          distanceMeters: batch.activities[0].distanceMeters,
          durationSeconds: batch.activities[0].durationSeconds,
          elapsedSeconds: batch.activities[0].elapsedSeconds,
          surface: batch.activities[0].surface,
          avgHr: batch.activities[0].avgHr,
          maxHr: batch.activities[0].maxHr,
          avgPaceSecPerKm: batch.activities[0].avgPaceSecPerKm,
          cadence: batch.activities[0].cadence,
          sport: batch.activities[0].sport,
          elevationGainMeters: batch.activities[0].elevationGainMeters,
          workoutType: batch.activities[0].workoutType,
          // Splits/route only come from DETAIL fetches (webhook); list-based
          // re-syncs send null — never let them wipe data we already captured.
          splits: sql`coalesce(excluded.splits, ${activities.splits})`,
          mapPolyline: sql`coalesce(excluded.map_polyline, ${activities.mapPolyline})`,
        },
      });
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
