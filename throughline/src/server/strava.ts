/**
 * Strava pull sync + token lifecycle. The connect flow stores tokens in
 * connected_accounts; this module keeps the access token fresh and pulls the
 * athlete's activities into raw_events → normalized activities (the same
 * derived layer Garmin webhooks feed). Activities are the entry point; HRV /
 * sleep / resting-HR follow when we add a wearable provider.
 */
import { and, desc, eq, like } from 'drizzle-orm';
import type { DB } from '@/db';
import { connectedAccounts, rawEvents, activities } from '@/db/schema';
import { getProvider } from '@/providers';
import { strava, type StravaActivity } from '@/providers/strava';
import { stravaEnv } from '@/providers/strava/env';
import { persistNormalizedBatch } from '@/server/ingest';
import { payloadHash } from '@/lib/hash';

const TOKEN_SKEW_MS = 5 * 60 * 1000; // refresh if expiring within 5 min

export interface StravaAccount {
  id: string;
  athleteId: string;
  providerUserId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  status: string;
}

export async function getStravaAccount(db: DB, athleteId: string): Promise<StravaAccount | null> {
  const [acct] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.athleteId, athleteId), eq(connectedAccounts.provider, 'strava')))
    .limit(1);
  return acct ?? null;
}

/** Upsert tokens from a completed OAuth exchange. */
export async function saveStravaTokens(
  db: DB,
  athleteId: string,
  tokens: { providerUserId: string; accessToken: string; refreshToken?: string; expiresAt?: Date; scopes?: string[] },
): Promise<void> {
  const now = new Date();
  await db
    .insert(connectedAccounts)
    .values({
      athleteId,
      provider: 'strava',
      providerUserId: tokens.providerUserId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      tokenExpiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes ?? null,
      status: 'active',
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [connectedAccounts.provider, connectedAccounts.providerUserId],
      set: {
        athleteId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        tokenExpiresAt: tokens.expiresAt ?? null,
        scopes: tokens.scopes ?? null,
        status: 'active',
        connectedAt: now,
        updatedAt: now,
      },
    });
}

/** Return a valid access token, refreshing (and persisting) if near expiry. */
async function ensureAccessToken(db: DB, acct: StravaAccount): Promise<string> {
  const expMs = acct.tokenExpiresAt ? acct.tokenExpiresAt.getTime() : 0;
  if (acct.accessToken && expMs - Date.now() > TOKEN_SKEW_MS) {
    return acct.accessToken;
  }
  if (!acct.refreshToken) throw new Error('Strava account has no refresh token; reconnect required.');
  const refreshed = await strava.refreshTokens(acct.refreshToken);
  await db
    .update(connectedAccounts)
    .set({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? acct.refreshToken,
      tokenExpiresAt: refreshed.expiresAt ?? null,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, acct.id));
  return refreshed.accessToken;
}

/** The unix-seconds cursor for the next pull: just after the latest synced activity. */
async function lastSyncedAfter(db: DB, athleteId: string, fallbackDays: number): Promise<number> {
  const [latest] = await db
    .select({ startTime: activities.startTime })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), like(activities.sourceRef, 'strava:%')))
    .orderBy(desc(activities.startTime))
    .limit(1);
  if (latest?.startTime) return Math.floor(latest.startTime.getTime() / 1000);
  return Math.floor((Date.now() - fallbackDays * 86400000) / 1000);
}

export interface SyncResult {
  fetched: number;
  imported: number; // new raw events (new or updated activities)
}

/**
 * Pull activities since the last sync (or `fallbackDays` back on first run),
 * append each to raw_events, and normalize into the activities table.
 */
export async function syncStravaActivities(
  db: DB,
  athleteId: string,
  opts: { fallbackDays?: number; maxPages?: number; source?: 'backfill' | 'webhook' } = {},
): Promise<SyncResult> {
  const { fallbackDays = 365, maxPages = 10, source = 'backfill' } = opts;
  const acct = await getStravaAccount(db, athleteId);
  if (!acct) throw new Error('No Strava account connected for this athlete.');

  const token = await ensureAccessToken(db, acct);
  const after = await lastSyncedAfter(db, athleteId, fallbackDays);
  const { apiBaseUrl } = stravaEnv();
  const perPage = 200;

  let fetched = 0;
  let imported = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url = `${apiBaseUrl}/athlete/activities?after=${after}&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Strava activities fetch failed (HTTP ${res.status}).`);
    const list = (await res.json()) as StravaActivity[];
    if (!Array.isArray(list) || list.length === 0) break;
    fetched += list.length;
    for (const a of list) {
      const ok = await ingestStravaActivity(db, athleteId, acct.providerUserId, a, source);
      if (ok) imported++;
    }
    if (list.length < perPage) break;
  }
  return { fetched, imported };
}

/** Append one activity to raw_events (idempotent) and normalize it. */
export async function ingestStravaActivity(
  db: DB,
  athleteId: string,
  providerUserId: string | null,
  activity: StravaActivity,
  source: 'backfill' | 'webhook',
): Promise<boolean> {
  const hash = payloadHash(JSON.stringify({ id: activity.id }));
  const [inserted] = await db
    .insert(rawEvents)
    .values({
      athleteId,
      provider: 'strava',
      source,
      eventType: 'activity',
      providerUserId: providerUserId ?? undefined,
      payload: activity as object,
      payloadHash: hash,
    })
    .onConflictDoNothing({ target: [rawEvents.provider, rawEvents.eventType, rawEvents.payloadHash] })
    .returning({ id: rawEvents.id });

  // Normalize regardless (re-fetch via webhook 'update' should refresh the row),
  // but only count newly-captured raw events as imported.
  const batch = getProvider('strava').normalize('activity', activity);
  await persistNormalizedBatch(db, athleteId, inserted?.id ?? null, batch);
  if (inserted?.id) {
    await db.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, inserted.id));
    return true;
  }
  return false;
}

/** Fetch a single activity by id (used by webhook events, which carry only ids). */
export async function fetchAndIngestActivityById(
  db: DB,
  athleteId: string,
  activityId: number | string,
): Promise<boolean> {
  const acct = await getStravaAccount(db, athleteId);
  if (!acct) throw new Error('No Strava account connected for this athlete.');
  const token = await ensureAccessToken(db, acct);
  const { apiBaseUrl } = stravaEnv();
  const res = await fetch(`${apiBaseUrl}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava activity ${activityId} fetch failed (HTTP ${res.status}).`);
  const activity = (await res.json()) as StravaActivity;
  return ingestStravaActivity(db, athleteId, acct.providerUserId, activity, 'webhook');
}

/** Map a Strava owner (athlete) id to our athlete via connected_accounts. */
export async function athleteIdForStravaOwner(db: DB, ownerId: string): Promise<string | null> {
  const [acct] = await db
    .select({ athleteId: connectedAccounts.athleteId })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.provider, 'strava'), eq(connectedAccounts.providerUserId, ownerId)))
    .limit(1);
  return acct?.athleteId ?? null;
}
