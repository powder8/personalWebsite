/**
 * Apple Health (HealthKit) push ingest. Apple exposes no server API — HealthKit
 * data lives on-device — so recovery data reaches us only when an on-device iOS
 * exporter (e.g. the Health Auto Export app's REST automation) POSTs it to our
 * endpoint. We authenticate that push with a per-athlete bearer TOKEN (the app
 * can't hold a browser session), stored in connected_accounts like an OAuth
 * token, and reuse the normal normalize → persist pipeline.
 *
 * The token is the credential: high-entropy, shown once at generation, matched
 * by value on ingest. Rotating it invalidates the old one.
 */
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { connectedAccounts, rawEvents } from '@/db/schema';
import { payloadHash } from '@/lib/hash';
import { normalizeAppleHealth } from '@/providers/apple/normalize';
import { persistNormalizedBatch } from './ingest';

const PROVIDER = 'apple' as const;

/** One apple account per athlete: providerUserId carries the athlete id so the
 *  (provider, providerUserId) unique key upserts cleanly. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Generate (or rotate) the athlete's ingest token and return the RAW value —
 *  the only time it is exposed. */
export async function rotateAppleHealthToken(db: DB, athleteId: string): Promise<string> {
  const token = newToken();
  const now = new Date();
  await db
    .insert(connectedAccounts)
    .values({
      athleteId,
      provider: PROVIDER,
      providerUserId: athleteId,
      accessToken: token,
      status: 'active',
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [connectedAccounts.provider, connectedAccounts.providerUserId],
      set: { athleteId, accessToken: token, status: 'active', updatedAt: now },
    });
  return token;
}

export interface AppleHealthStatus {
  connected: boolean;
}

/** Whether the athlete has an ingest token set (never returns the token itself). */
export async function getAppleHealthStatus(db: DB, athleteId: string): Promise<AppleHealthStatus> {
  const [row] = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.athleteId, athleteId), eq(connectedAccounts.provider, PROVIDER)))
    .limit(1);
  return { connected: !!row };
}

/** Resolve which athlete a raw ingest token belongs to (or null). The token is
 *  high-entropy, so an indexed equality lookup is an acceptable match. */
export async function findAthleteIdByAppleToken(db: DB, token: string): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const [row] = await db
    .select({ athleteId: connectedAccounts.athleteId })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.provider, PROVIDER), eq(connectedAccounts.accessToken, token)))
    .limit(1);
  return row?.athleteId ?? null;
}

export interface AppleIngestResult {
  hrv: number;
  restingHr: number;
  sleep: number;
  duplicate: boolean;
}

/** Ingest one Apple Health push: store the raw event (idempotent), normalize,
 *  and persist the recovery records. */
export async function ingestAppleHealth(db: DB, athleteId: string, payload: unknown): Promise<AppleIngestResult> {
  const hash = payloadHash(JSON.stringify(payload ?? null));
  const [raw] = await db
    .insert(rawEvents)
    .values({
      athleteId,
      provider: PROVIDER,
      source: 'webhook',
      eventType: 'healthkit',
      payload: (payload ?? {}) as object,
      payloadHash: hash,
      receivedAt: new Date(),
    })
    .onConflictDoNothing({ target: [rawEvents.provider, rawEvents.eventType, rawEvents.payloadHash] })
    .returning({ id: rawEvents.id });

  // Identical re-post: the raw event already exists, so its records are already
  // persisted — nothing more to do.
  if (!raw) return { hrv: 0, restingHr: 0, sleep: 0, duplicate: true };

  const batch = normalizeAppleHealth(payload);
  await persistNormalizedBatch(db, athleteId, raw.id, batch, PROVIDER);

  return {
    hrv: batch.hrvRecords?.length ?? 0,
    restingHr: batch.restingHrRecords?.length ?? 0,
    sleep: batch.sleepRecords?.length ?? 0,
    duplicate: false,
  };
}
