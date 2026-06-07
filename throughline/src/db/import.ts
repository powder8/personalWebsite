/**
 * Persist parsed training-log days. Per the spec, every import lands in
 * RawEvent first (append-only), then derives a normalized Activity. Idempotent:
 * re-importing the same file does not duplicate rows.
 */
import type { DB } from './client';
import { rawEvents, activities, sleepRecords, restingHrRecords, checkIns } from './schema';
import { payloadHash } from '@/lib/hash';
import type { ParsedDay } from '@/providers/manual/parseTrainingLog';

const MI_TO_M = 1609.344;

export interface ImportResult {
  days: number;
  rawEvents: number;
  activities: number;
  dateBugFixes: number;
  pacesParsed: number;
  wellness: number; // sleep / resting-HR / check-in records written
}

export async function importParsedDays(
  db: DB,
  athleteId: string,
  days: ParsedDay[],
  fileMeta: { fileName: string },
): Promise<ImportResult> {
  let rawCount = 0;
  let actCount = 0;
  let dateBugFixes = 0;
  let pacesParsed = 0;
  let wellness = 0;

  for (const d of days) {
    if (d.assignedMiles?.wasDateBug) dateBugFixes++;
    if (d.avgPaceSecPerKm != null) pacesParsed++;

    // 1) Append-only RawEvent (verbatim parsed payload).
    const payload = { ...d, file: fileMeta.fileName };
    const hash = payloadHash(
      JSON.stringify({ athleteId, date: d.date, actual: d.actualMiles, workout: d.workout, desc: d.description }),
    );
    const inserted = await db
      .insert(rawEvents)
      .values({
        athleteId,
        provider: 'manual',
        source: 'file_upload',
        eventType: 'training_log_day',
        payload,
        payloadHash: hash,
      })
      .onConflictDoNothing({ target: [rawEvents.provider, rawEvents.eventType, rawEvents.payloadHash] })
      .returning({ id: rawEvents.id });
    if (inserted.length) rawCount++;

    // 2) Normalized Activity for days that were actually run (idempotent by sourceRef).
    if (d.actualMiles != null && d.actualMiles > 0) {
      const sourceRef = `manual:${athleteId}:${d.date}`;
      const distanceMeters = d.actualMiles * MI_TO_M;
      await db
        .insert(activities)
        .values({
          athleteId,
          sport: d.sport,
          startTime: new Date(`${d.date}T12:00:00Z`),
          durationSeconds: d.durationSeconds,
          distanceMeters,
          avgPaceSecPerKm: d.avgPaceSecPerKm,
          sourceRef,
        })
        .onConflictDoUpdate({
          target: activities.sourceRef,
          set: {
            distanceMeters,
            durationSeconds: d.durationSeconds,
            avgPaceSecPerKm: d.avgPaceSecPerKm,
            sport: d.sport,
          },
        });
      actCount++;
    }

    // 3) Wellness signals (readiness inputs) — written when the log has them.
    if (d.sleepHours != null && d.sleepHours > 0) {
      const r = await db
        .insert(sleepRecords)
        .values({ athleteId, day: d.date, totalSleepSeconds: Math.round(d.sleepHours * 3600) })
        .onConflictDoNothing({ target: [sleepRecords.athleteId, sleepRecords.day] })
        .returning({ id: sleepRecords.id });
      if (r.length) wellness++;
    }
    if (d.restingHr != null && d.restingHr > 0) {
      const r = await db
        .insert(restingHrRecords)
        .values({ athleteId, day: d.date, restingHr: Math.round(d.restingHr) })
        .onConflictDoNothing({ target: [restingHrRecords.athleteId, restingHrRecords.day] })
        .returning({ id: restingHrRecords.id });
      if (r.length) wellness++;
    }
    if (d.feel != null && d.feel > 0) {
      const r = await db
        .insert(checkIns)
        .values({ athleteId, day: d.date, energy: Math.max(0, Math.min(10, Math.round(d.feel * 2))) })
        .onConflictDoNothing({ target: [checkIns.athleteId, checkIns.day] })
        .returning({ id: checkIns.id });
      if (r.length) wellness++;
    }
  }

  return {
    days: days.length,
    rawEvents: rawCount,
    activities: actCount,
    dateBugFixes,
    pacesParsed,
    wellness,
  };
}
