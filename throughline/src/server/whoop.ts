/**
 * Whoop token lifecycle + data sync. Mirrors the pattern from server/strava.ts:
 * tokens live in connected_accounts; ensureAccessToken refreshes when near expiry
 * and persists the new tokens. Sync writes to the existing wearable tables
 * (hrv_records, resting_hr_records, sleep_records, daily_summaries) with
 * provider = 'whoop'.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  connectedAccounts,
  hrvRecords,
  restingHrRecords,
  sleepRecords,
  dailySummaries,
} from '@/db/schema';
import {
  refreshTokens,
  fetchRecoveries,
  fetchSleepRecords,
  type WhoopRecovery,
  type WhoopSleep,
} from '@/providers/whoop';

const TOKEN_SKEW_MS = 5 * 60 * 1000;

export interface WhoopAccount {
  id: string;
  athleteId: string;
  providerUserId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  status: string;
}

export async function getWhoopAccount(db: DB, athleteId: string): Promise<WhoopAccount | null> {
  const [acct] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.athleteId, athleteId), eq(connectedAccounts.provider, 'whoop')))
    .limit(1);
  return acct ?? null;
}

export async function saveWhoopTokens(
  db: DB,
  athleteId: string,
  tokens: { providerUserId: string; accessToken: string; refreshToken: string; expiresAt: Date; scopes: string[] },
): Promise<void> {
  const now = new Date();
  await db
    .insert(connectedAccounts)
    .values({
      athleteId,
      provider: 'whoop',
      providerUserId: tokens.providerUserId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      status: 'active',
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [connectedAccounts.provider, connectedAccounts.providerUserId],
      set: {
        athleteId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        status: 'active',
        connectedAt: now,
        updatedAt: now,
      },
    });
}

async function ensureAccessToken(db: DB, acct: WhoopAccount): Promise<string> {
  const expMs = acct.tokenExpiresAt ? acct.tokenExpiresAt.getTime() : 0;
  if (acct.accessToken && expMs - Date.now() > TOKEN_SKEW_MS) {
    return acct.accessToken;
  }
  if (!acct.refreshToken) throw new Error('Whoop account has no refresh token; reconnect required.');
  const refreshed = await refreshTokens(acct.refreshToken);
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

// ---------------------------------------------------------------------------
// Normalise Whoop records → DB rows
// ---------------------------------------------------------------------------

/** Calendar day (YYYY-MM-DD) from an ISO-8601 UTC string. */
function isoToDay(iso: string): string {
  return iso.slice(0, 10);
}

function upsertHrv(db: DB, athleteId: string, day: string, rmssdMs: number) {
  return db
    .insert(hrvRecords)
    .values({ athleteId, day, provider: 'whoop', overnightAvgMs: rmssdMs })
    .onConflictDoUpdate({
      target: [hrvRecords.athleteId, hrvRecords.day],
      set: { overnightAvgMs: rmssdMs, provider: 'whoop' },
    });
}

function upsertRestingHr(db: DB, athleteId: string, day: string, hr: number) {
  return db
    .insert(restingHrRecords)
    .values({ athleteId, day, provider: 'whoop', restingHr: hr })
    .onConflictDoUpdate({
      target: [restingHrRecords.athleteId, restingHrRecords.day],
      set: { restingHr: hr, provider: 'whoop' },
    });
}

function upsertSleep(db: DB, athleteId: string, day: string, sleep: WhoopSleep) {
  const s = sleep.score?.stage_summary;
  const totalMs =
    s == null
      ? null
      : s.total_light_sleep_time_milli +
        s.total_slow_wave_sleep_time_milli +
        s.total_rem_sleep_time_milli;

  return db
    .insert(sleepRecords)
    .values({
      athleteId,
      day,
      provider: 'whoop',
      totalSleepSeconds: totalMs != null ? Math.round(totalMs / 1000) : null,
      deepSeconds: s?.total_slow_wave_sleep_time_milli != null ? Math.round(s.total_slow_wave_sleep_time_milli / 1000) : null,
      remSeconds: s?.total_rem_sleep_time_milli != null ? Math.round(s.total_rem_sleep_time_milli / 1000) : null,
      lightSeconds: s?.total_light_sleep_time_milli != null ? Math.round(s.total_light_sleep_time_milli / 1000) : null,
      awakeSeconds: s?.total_awake_time_milli != null ? Math.round(s.total_awake_time_milli / 1000) : null,
      sleepScore: sleep.score?.sleep_performance_percentage != null
        ? Math.round(sleep.score.sleep_performance_percentage)
        : null,
      metrics: {
        respiratory_rate: sleep.score?.respiratory_rate ?? null,
        sleep_performance_pct: sleep.score?.sleep_performance_percentage ?? null,
        sleep_consistency_pct: sleep.score?.sleep_consistency_percentage ?? null,
        sleep_efficiency_pct: sleep.score?.sleep_efficiency_percentage ?? null,
        sleep_need_baseline_sec: sleep.score?.sleep_needed?.baseline_milli != null
          ? Math.round(sleep.score.sleep_needed.baseline_milli / 1000) : null,
      },
    })
    .onConflictDoUpdate({
      target: [sleepRecords.athleteId, sleepRecords.day],
      set: {
        provider: 'whoop',
        totalSleepSeconds: sql`excluded.total_sleep_seconds`,
        deepSeconds: sql`excluded.deep_seconds`,
        remSeconds: sql`excluded.rem_seconds`,
        lightSeconds: sql`excluded.light_seconds`,
        awakeSeconds: sql`excluded.awake_seconds`,
        sleepScore: sql`excluded.sleep_score`,
        metrics: sql`excluded.metrics`,
      },
    });
}

function upsertDailySummary(db: DB, athleteId: string, day: string, recovery: WhoopRecovery) {
  const metrics = {
    recovery_score: recovery.score?.recovery_score ?? null,
    spo2_percentage: recovery.score?.spo2_percentage ?? null,
    skin_temp_celsius: recovery.score?.skin_temp_celsius ?? null,
    cycle_id: recovery.cycle_id,
  };
  return db
    .insert(dailySummaries)
    .values({
      athleteId,
      day,
      provider: 'whoop',
      restingHr: recovery.score?.resting_heart_rate ?? null,
      metrics,
    })
    .onConflictDoUpdate({
      target: [dailySummaries.athleteId, dailySummaries.day],
      set: {
        restingHr: recovery.score?.resting_heart_rate ?? null,
        metrics: sql`daily_summaries.metrics || excluded.metrics`,
      },
    });
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export interface WhoopSyncResult {
  days: number;
  recoveries: number;
  sleepRecordsSynced: number;
}

/**
 * Pull the last `days` days of Whoop recovery and sleep data and upsert into
 * the wearable tables. Safe to call multiple times — idempotent via upserts.
 */
export async function syncWhoopData(
  db: DB,
  athleteId: string,
  days = 14,
): Promise<WhoopSyncResult> {
  const acct = await getWhoopAccount(db, athleteId);
  if (!acct) throw new Error('No Whoop account connected for this athlete.');

  const token = await ensureAccessToken(db, acct);

  const now = new Date();
  const start = new Date(now.getTime() - days * 86400_000);
  const startISO = start.toISOString();
  const endISO = now.toISOString();

  const [recoveries, sleepList] = await Promise.all([
    fetchRecoveries(token, startISO, endISO),
    fetchSleepRecords(token, startISO, endISO),
  ]);

  // Index sleep records by cycle_id so we can join them to recovery records.
  const sleepByCycleId = new Map<number, WhoopSleep>();
  for (const s of sleepList) {
    // Whoop sleep id === recovery.sleep_id
    sleepByCycleId.set(s.id, s);
  }

  let syncedRecoveries = 0;
  let syncedSleep = 0;

  for (const rec of recoveries) {
    if (rec.score_state !== 'SCORED' || !rec.score) continue;

    const day = isoToDay(rec.created_at);
    const score = rec.score;

    await Promise.all([
      upsertHrv(db, athleteId, day, score.hrv_rmssd_milli),
      upsertRestingHr(db, athleteId, day, score.resting_heart_rate),
      upsertDailySummary(db, athleteId, day, rec),
    ]);

    const sleep = sleepByCycleId.get(rec.sleep_id);
    if (sleep?.score_state === 'SCORED') {
      const sleepDay = isoToDay(sleep.end);
      await upsertSleep(db, athleteId, sleepDay, sleep);
      syncedSleep++;
    }

    syncedRecoveries++;
  }

  return { days, recoveries: syncedRecoveries, sleepRecordsSynced: syncedSleep };
}

// ---------------------------------------------------------------------------
// Status query (for settings page)
// ---------------------------------------------------------------------------

export interface WhoopStatus {
  configured: boolean;
  connected: boolean;
  latestDay: string | null;
  recoveryScore: number | null;
  hrv: number | null;
}

export async function getWhoopStatus(db: DB, athleteId: string): Promise<WhoopStatus> {
  const { whoopConfigured } = await import('@/providers/whoop/env');
  const configured = whoopConfigured();
  if (!configured) return { configured, connected: false, latestDay: null, recoveryScore: null, hrv: null };

  const acct = await getWhoopAccount(db, athleteId);
  if (!acct || acct.status !== 'active') {
    return { configured, connected: false, latestDay: null, recoveryScore: null, hrv: null };
  }

  const [latestHrv] = await db
    .select({ day: hrvRecords.day, overnightAvgMs: hrvRecords.overnightAvgMs })
    .from(hrvRecords)
    .where(and(eq(hrvRecords.athleteId, athleteId), eq(hrvRecords.provider, 'whoop')))
    .orderBy(sql`${hrvRecords.day} desc`)
    .limit(1);

  const [latestSummary] = await db
    .select({ metrics: dailySummaries.metrics })
    .from(dailySummaries)
    .where(and(eq(dailySummaries.athleteId, athleteId), eq(dailySummaries.provider, 'whoop')))
    .orderBy(sql`${dailySummaries.day} desc`)
    .limit(1);

  const metrics = latestSummary?.metrics as Record<string, number | null> | null;
  return {
    configured,
    connected: true,
    latestDay: latestHrv?.day ?? null,
    hrv: latestHrv?.overnightAvgMs != null ? Math.round(latestHrv.overnightAvgMs) : null,
    recoveryScore: metrics?.recovery_score ?? null,
  };
}

/** Map a Whoop user_id to our athlete via connected_accounts. Used in webhooks. */
export async function athleteIdForWhoopUser(db: DB, whoopUserId: string): Promise<string | null> {
  const [acct] = await db
    .select({ athleteId: connectedAccounts.athleteId })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.provider, 'whoop'), eq(connectedAccounts.providerUserId, whoopUserId)))
    .limit(1);
  return acct?.athleteId ?? null;
}
