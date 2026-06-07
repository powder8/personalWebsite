/**
 * Background functions. Today: normalize a RawEvent into typed signal rows.
 *
 * Invariant: this reads from raw_events (append-only) and writes DERIVED rows.
 * It must be idempotent — re-running on the same RawEvent reproduces identical
 * derived state (upserts on natural keys), so the whole derived layer is
 * re-buildable by replaying events.
 */
import { eq } from 'drizzle-orm';
import { inngest, events } from './client';
import { getDb } from '@/db';
import {
  rawEvents,
  activities,
  dailySummaries,
  sleepRecords,
  hrvRecords,
  restingHrRecords,
} from '@/db/schema';
import { getProvider } from '@/providers';

export const normalizeRawEvent = inngest.createFunction(
  { id: 'normalize-raw-event', retries: 4, triggers: [{ event: events.rawEventReceived }] },
  async ({ event, step }) => {
    const rawEventId = event.data.rawEventId as string;
    const db = await getDb();

    const raw = await step.run('load-raw-event', async () => {
      const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
      return row ?? null;
    });

    if (!raw) return { skipped: 'raw-event-not-found' };
    if (!raw.athleteId) return { skipped: 'unmapped-provider-user' };
    if (raw.processedAt) return { skipped: 'already-processed' };
    // Manual imports are normalized at import time, not here. Capture into a
    // const so the narrowing survives into the step closure below.
    const providerId = raw.provider;
    if (providerId !== 'garmin') return { skipped: 'non-provider-event' };

    const athleteId = raw.athleteId;

    // Normalize and persist in ONE step: Inngest JSON-serializes values that
    // cross a step boundary (Date -> string), which would break typed inserts.
    // Keeping both in a single closure preserves real Date/typed values.
    await step.run('normalize-and-persist', async () => {
      const provider = getProvider(providerId);
      const batch = provider.normalize(raw.eventType, raw.payload);
      const common = { athleteId, rawEventId: raw.id };

      if (batch.activities?.length) {
        await db
          .insert(activities)
          .values(batch.activities.map((a) => ({ ...a, ...common })))
          .onConflictDoNothing({ target: activities.sourceRef });
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
    });

    // Mark consumed (the one allowed write to a raw_event).
    await step.run('mark-processed', async () => {
      await db
        .update(rawEvents)
        .set({ processedAt: new Date() })
        .where(eq(rawEvents.id, raw.id));
    });

    // TODO(phase-2): emit a 'signals.updated' event to recompute baselines +
    // fitness/fatigue state for this athlete/day.
    return { ok: true, athleteId };
  },
);

export const functions = [normalizeRawEvent];
