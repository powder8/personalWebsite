/**
 * Persist a provider's NormalizedBatch into the derived tables. Idempotent:
 * upserts on natural keys so replaying the same raw event reproduces identical
 * state. Shared by the async normalizer (Inngest) and the Strava pull sync, so
 * there is ONE place that knows how a batch lands in the DB.
 */
import type { DB } from '@/db';
import {
  activities,
  dailySummaries,
  sleepRecords,
  hrvRecords,
  restingHrRecords,
} from '@/db/schema';
import type { NormalizedBatch } from '@/providers/types';

export async function persistNormalizedBatch(
  db: DB,
  athleteId: string,
  rawEventId: string | null,
  batch: NormalizedBatch,
): Promise<void> {
  const common = { athleteId, rawEventId };

  // Both callers emit a single-activity batch per raw event, so the upsert `set`
  // below safely references batch.activities[0].
  if (batch.activities?.length) {
    await db
      .insert(activities)
      .values(batch.activities.map((a) => ({ ...a, ...common })))
      .onConflictDoUpdate({
        target: activities.sourceRef,
        set: {
          distanceMeters: batch.activities[0].distanceMeters,
          durationSeconds: batch.activities[0].durationSeconds,
          avgHr: batch.activities[0].avgHr,
          maxHr: batch.activities[0].maxHr,
          avgPaceSecPerKm: batch.activities[0].avgPaceSecPerKm,
          cadence: batch.activities[0].cadence,
          sport: batch.activities[0].sport,
        },
      });
  }
  if (batch.dailySummaries?.length) {
    await db
      .insert(dailySummaries)
      .values(batch.dailySummaries.map((d) => ({ ...d, ...common })))
      .onConflictDoUpdate({
        target: [dailySummaries.athleteId, dailySummaries.day],
        set: { metrics: batch.dailySummaries[0].metrics },
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
