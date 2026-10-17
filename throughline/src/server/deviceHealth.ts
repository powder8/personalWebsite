/**
 * Device-health ingest: the server half of HealthKit (iOS) and Health Connect
 * (Android). Neither store has a server API — the data lives on the phone — so
 * the native app reads it and POSTs a normalized payload with the athlete's
 * ordinary session (the app's web view shares the auth cookie). From there it
 * rides the same rawEvents → NormalizedBatch → persist pipeline as every other
 * provider, so the health tracker, recovery, and load model see one shape.
 *
 * Idempotent on the payload hash; per-athlete rate-limited by counting raw
 * events in Postgres (durable across serverless instances).
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { connectedAccounts, rawEvents } from '@/db/schema';
import { payloadHash } from '@/lib/hash';
import { dropAlreadyRecorded, persistNormalizedBatch } from './ingest';
import { PROVIDER_FOR_SOURCE, toNormalizedBatch, validateDevicePayload, type DeviceProvider } from './deviceHealthLogic';

export const EVENT_TYPE = 'device_health';

/** A phone pushes a few times a day; this caps an authenticated flood. */
export const DEVICE_INGEST_RATE = { maxPerWindow: 60, windowMs: 60 * 60 * 1000 };

export type DeviceIngestResult =
  | { ok: false; status: 400 | 429; error: string }
  | {
      ok: true;
      duplicate: boolean;
      counts: { days: number; sleep: number; hrv: number; restingHr: number; workouts: number; workoutsDeduped: number };
      skipped: string[];
    };

async function recentEventCount(db: DB, athleteId: string, provider: DeviceProvider, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rawEvents)
    .where(and(eq(rawEvents.athleteId, athleteId), eq(rawEvents.provider, provider), gt(rawEvents.receivedAt, since)));
  return row?.n ?? 0;
}

/** Mark the device store as a connected source (so the UI can show it and last-sync). */
async function touchConnection(db: DB, athleteId: string, provider: DeviceProvider): Promise<void> {
  const now = new Date();
  await db
    .insert(connectedAccounts)
    .values({ athleteId, provider, providerUserId: athleteId, status: 'active', connectedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [connectedAccounts.provider, connectedAccounts.providerUserId],
      set: { athleteId, status: 'active', updatedAt: now },
    });
}

/**
 * Ingest one device push: validate → rate-check → store the raw event
 * (idempotent) → map → dedup workouts → persist.
 */
export async function ingestDeviceHealth(
  db: DB,
  athleteId: string,
  raw: unknown,
  today: string,
  rate: { maxPerWindow: number; windowMs: number } = DEVICE_INGEST_RATE,
): Promise<DeviceIngestResult> {
  const v = validateDevicePayload(raw);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const provider = PROVIDER_FOR_SOURCE[v.payload.source];

  if ((await recentEventCount(db, athleteId, provider, rate.windowMs)) >= rate.maxPerWindow) {
    return { ok: false, status: 429, error: 'Too many pushes this hour. Try again later.' };
  }

  // The hash covers athlete + payload so two athletes on the same household
  // phone can't dedup each other's identical-looking pushes.
  const hash = payloadHash(JSON.stringify({ athleteId, payload: v.payload }));
  const [rawRow] = await db
    .insert(rawEvents)
    .values({
      athleteId,
      provider,
      source: 'webhook',
      eventType: EVENT_TYPE,
      providerUserId: athleteId,
      payload: v.payload as object,
      payloadHash: hash,
      processedAt: new Date(),
    })
    .onConflictDoNothing({ target: [rawEvents.provider, rawEvents.eventType, rawEvents.payloadHash] })
    .returning({ id: rawEvents.id });

  const empty = { days: 0, sleep: 0, hrv: 0, restingHr: 0, workouts: 0, workoutsDeduped: 0 };
  if (!rawRow) return { ok: true, duplicate: true, counts: empty, skipped: [] };

  const { batch, skipped, counts } = toNormalizedBatch(v.payload, today);
  const { kept, deduped } = await dropAlreadyRecorded(db, athleteId, provider, batch.activities ?? []);
  await persistNormalizedBatch(db, athleteId, rawRow.id, { ...batch, activities: kept }, provider);
  await touchConnection(db, athleteId, provider);

  return {
    ok: true,
    duplicate: false,
    counts: { ...counts, workouts: kept.length, workoutsDeduped: deduped },
    skipped,
  };
}
