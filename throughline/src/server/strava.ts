/**
 * Strava pull sync + token lifecycle. The connect flow stores tokens in
 * connected_accounts; this module keeps the access token fresh and pulls the
 * athlete's activities into raw_events → normalized activities (the same
 * derived layer Garmin webhooks feed). Activities are the entry point; HRV /
 * sleep / resting-HR follow when we add a wearable provider.
 */
import { and, desc, eq, like, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { connectedAccounts, rawEvents, activities } from '@/db/schema';
import { strava, normalizeActivity, type StravaActivity } from '@/providers/strava';
import { stravaEnv } from '@/providers/strava/env';
import { payloadHash } from '@/lib/hash';
import {
  pickFtpCandidates,
  ftpFromWattsStream,
  combineFtpEstimates,
  type RideSummary,
} from '@/lib/ftpEstimate';

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

export interface StravaRouteStats {
  name: string | null;
  distanceMeters: number;
  elevationGainMeters: number;
}

/**
 * Fetch a Strava route's distance + total elevation via the athlete's own token.
 * `routeId` MUST be the validated numeric id from parseStravaRouteId — the URL is
 * built here (never the user's pasted link), so there's no SSRF surface. Public
 * routes work with our `read` scope; private ones need the owner + read_all.
 */
export async function fetchStravaRoute(db: DB, athleteId: string, routeId: string): Promise<StravaRouteStats> {
  if (!/^\d{4,}$/.test(routeId)) throw new Error('Invalid route id.');
  const acct = await getStravaAccount(db, athleteId);
  if (!acct || acct.status !== 'active') throw new Error('Connect your Strava account first.');
  const token = await ensureAccessToken(db, acct);
  const { apiBaseUrl } = stravaEnv();

  const res = await fetch(`${apiBaseUrl}/routes/${routeId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new Error("Couldn't find that route — is the link right, and is the route public?");
  if (res.status === 401 || res.status === 403) throw new Error('Strava wouldn’t share that route — make it public, or reconnect Strava.');
  if (res.status === 429) throw new Error('Strava is rate-limiting right now — try again in a minute.');
  if (!res.ok) throw new Error(`Strava route lookup failed (HTTP ${res.status}).`);

  const j = (await res.json()) as { name?: string; distance?: number; elevation_gain?: number };
  const distanceMeters = Number(j.distance) || 0;
  const elevationGainMeters = Math.max(0, Number(j.elevation_gain) || 0);
  if (!(distanceMeters > 0)) throw new Error('That route has no distance data.');
  return { name: j.name ?? null, distanceMeters, elevationGainMeters };
}

export interface FtpEstimateResult {
  ftpWatts: number;
  confidence: 'high' | 'medium' | 'low';
  sampleSize: number;
}

/**
 * Estimate the athlete's FTP from their recent Strava rides: pick real-power
 * sustained rides, pull the watts stream for the hardest few, take the best
 * 20-min power × 0.95. Returns null when there's no usable power data (no power
 * meter, or all rides too short) — the caller falls back to manual entry.
 */
export async function estimateFtpFromStrava(db: DB, athleteId: string): Promise<FtpEstimateResult | null> {
  const acct = await getStravaAccount(db, athleteId);
  if (!acct || acct.status !== 'active') throw new Error('Connect your Strava account first.');
  const token = await ensureAccessToken(db, acct);
  const { apiBaseUrl } = stravaEnv();
  const auth = { Authorization: `Bearer ${token}` };

  const after = Math.floor((Date.now() - 120 * 86400000) / 1000); // last ~4 months
  const listRes = await fetch(`${apiBaseUrl}/athlete/activities?after=${after}&per_page=100`, { headers: auth });
  if (listRes.status === 429) throw new Error('Strava is rate-limiting right now — try again in a minute.');
  if (!listRes.ok) throw new Error(`Strava activity fetch failed (HTTP ${listRes.status}).`);

  const acts = (await listRes.json()) as Array<{
    id: number;
    type?: string;
    sport_type?: string;
    moving_time?: number;
    weighted_average_watts?: number;
    device_watts?: boolean;
  }>;
  const rides: RideSummary[] = acts
    .filter((a) => {
      const s = a.sport_type ?? a.type;
      return s === 'Ride' || s === 'VirtualRide' || s === 'GravelRide' || s === 'MountainBikeRide';
    })
    .map((a) => ({
      id: a.id,
      durationSeconds: a.moving_time ?? 0,
      weightedAvgWatts: a.weighted_average_watts ?? null,
      deviceWatts: !!a.device_watts,
    }));

  const candidates = pickFtpCandidates(rides);
  if (candidates.length === 0) return null;

  const perRideFtp: number[] = [];
  for (const c of candidates) {
    try {
      const sRes = await fetch(`${apiBaseUrl}/activities/${c.id}/streams?keys=time,watts&key_by_type=true`, { headers: auth });
      if (!sRes.ok) continue;
      const s = (await sRes.json()) as { time?: { data?: number[] }; watts?: { data?: number[] } };
      const times = s.time?.data;
      const watts = s.watts?.data;
      if (!times || !watts || times.length < 60) continue;
      const ftp = ftpFromWattsStream(times, watts);
      if (ftp > 0) perRideFtp.push(ftp);
    } catch {
      /* skip a ride whose stream failed */
    }
  }
  return combineFtpEstimates(perRideFtp);
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
  fetched: number; // activities pulled from Strava this call
  imported: number; // NEW raw events captured this call
  done: boolean; // false → more pages remain; call again with `afterOverride: nextAfter`
  nextAfter: number | null; // unix cursor to continue from
  rateLimited?: boolean; // Strava 429 — back off and resume from nextAfter
  retryAfterSec?: number; // suggested wait before resuming (when rateLimited)
}

/**
 * Ingest a PAGE of activities in two batched writes (instead of ~3 queries per
 * activity). Raw events are appended (idempotent on the id-hash) with
 * processedAt set, and activities are upserted by sourceRef using each row's own
 * incoming values (`excluded.*`). Returns the count of newly-captured events.
 */
async function ingestStravaPage(
  db: DB,
  athleteId: string,
  providerUserId: string | null,
  list: StravaActivity[],
  source: 'backfill' | 'webhook',
): Promise<number> {
  if (list.length === 0) return 0;
  const now = new Date();
  const rawValues = list.map((a) => ({
    athleteId,
    provider: 'strava' as const,
    source,
    eventType: 'activity',
    providerUserId: providerUserId ?? undefined,
    payload: a as object,
    payloadHash: payloadHash(JSON.stringify({ id: a.id })),
    processedAt: now,
  }));
  const insertedRaw = await db
    .insert(rawEvents)
    .values(rawValues)
    .onConflictDoNothing({ target: [rawEvents.provider, rawEvents.eventType, rawEvents.payloadHash] })
    .returning({ id: rawEvents.id });

  const actValues = list.map((a) => ({ ...normalizeActivity(a), athleteId, provider: 'strava' as const }));
  await db
    .insert(activities)
    .values(actValues)
    .onConflictDoUpdate({
      target: activities.sourceRef,
      set: {
        name: sql`excluded.name`,
        workoutType: sql`excluded.workout_type`,
        distanceMeters: sql`excluded.distance_meters`,
        durationSeconds: sql`excluded.duration_seconds`,
        avgHr: sql`excluded.avg_hr`,
        maxHr: sql`excluded.max_hr`,
        avgPaceSecPerKm: sql`excluded.avg_pace_sec_per_km`,
        cadence: sql`excluded.cadence`,
        sport: sql`excluded.sport`,
      },
    });
  return insertedRaw.length;
}

/**
 * Pull a CHUNK of activities and ingest them. Resumable + batched so it never
 * blows a serverless time limit regardless of history size:
 *  - `full`: start `fallbackDays` back (re-pull whole history).
 *  - `afterOverride`: continue from a prior call's `nextAfter` cursor.
 *  - otherwise: incremental, starting after the latest synced activity.
 * Strava returns `after` results oldest-first, so we advance the cursor to the
 * newest activity seen. `done:false` means call again with `nextAfter`.
 */
export async function syncStravaActivities(
  db: DB,
  athleteId: string,
  opts: {
    fallbackDays?: number;
    maxPages?: number;
    source?: 'backfill' | 'webhook';
    full?: boolean;
    afterOverride?: number;
  } = {},
): Promise<SyncResult> {
  const { fallbackDays = 365, maxPages = 5, source = 'backfill', full = false, afterOverride } = opts;
  const acct = await getStravaAccount(db, athleteId);
  if (!acct) throw new Error('No Strava account connected for this athlete.');

  const token = await ensureAccessToken(db, acct);
  const after =
    afterOverride != null
      ? afterOverride
      : full
        ? Math.floor((Date.now() - fallbackDays * 86400000) / 1000)
        : await lastSyncedAfter(db, athleteId, fallbackDays);
  const { apiBaseUrl } = stravaEnv();
  const perPage = 200;

  let fetched = 0;
  let imported = 0;
  let maxStart = after;
  let done = false;
  for (let page = 1; page <= maxPages; page++) {
    const url = `${apiBaseUrl}/athlete/activities?after=${after}&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    // Rate limited (Strava: 100 req / 15 min, 1000 / day). Don't throw — return
    // what we have plus a resume cursor so the client can back off and continue.
    if (res.status === 429) {
      const ra = parseInt(res.headers.get('retry-after') ?? '', 10);
      return {
        fetched,
        imported,
        done: false,
        nextAfter: maxStart,
        rateLimited: true,
        retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : 120,
      };
    }
    if (!res.ok) throw new Error(`Strava activities fetch failed (HTTP ${res.status}).`);
    const list = (await res.json()) as StravaActivity[];
    if (!Array.isArray(list) || list.length === 0) {
      done = true;
      break;
    }
    fetched += list.length;
    imported += await ingestStravaPage(db, athleteId, acct.providerUserId, list, source);
    for (const a of list) {
      const t = a.start_date ? Math.floor(new Date(a.start_date).getTime() / 1000) : 0;
      if (t > maxStart) maxStart = t;
    }
    if (list.length < perPage) {
      done = true;
      break;
    }
  }
  return { fetched, imported, done, nextAfter: done ? null : maxStart };
}

/** Ingest a single activity (webhook path). */
export async function ingestStravaActivity(
  db: DB,
  athleteId: string,
  providerUserId: string | null,
  activity: StravaActivity,
  source: 'backfill' | 'webhook',
): Promise<boolean> {
  const n = await ingestStravaPage(db, athleteId, providerUserId, [activity], source);
  return n > 0;
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
