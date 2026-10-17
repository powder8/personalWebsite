/**
 * Garmin account lifecycle: encrypted token storage + refresh, the API user
 * id, historical backfill, deregistration, and fetching PING notifications.
 * Mirrors server/strava.ts and server/whoop.ts.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { connectedAccounts } from '@/db/schema';
import { getProvider } from '@/providers';
import { garminEnv } from '@/providers/garmin/env';
import type { ProviderTokens } from '@/providers/types';
import { sealToken } from './tokenCrypto';
import { openAccountTokens } from './connectedAccountTokens';

const TOKEN_SKEW_MS = 5 * 60 * 1000;

export interface GarminAccount {
  id: string;
  athleteId: string;
  providerUserId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  status: string;
}

export async function getGarminAccount(db: DB, athleteId: string): Promise<GarminAccount | null> {
  const [acct] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.athleteId, athleteId), eq(connectedAccounts.provider, 'garmin')))
    .limit(1);
  if (!acct) return null;
  return openAccountTokens(db, acct);
}

export async function getGarminAccountByUserId(db: DB, garminUserId: string): Promise<GarminAccount | null> {
  const [acct] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.provider, 'garmin'), eq(connectedAccounts.providerUserId, garminUserId)))
    .limit(1);
  if (!acct) return null;
  return openAccountTokens(db, acct);
}

export async function saveGarminTokens(db: DB, athleteId: string, tokens: ProviderTokens): Promise<void> {
  const now = new Date();
  const values = {
    accessToken: sealToken(tokens.accessToken),
    refreshToken: sealToken(tokens.refreshToken ?? null),
    tokenExpiresAt: tokens.expiresAt ?? null,
    scopes: tokens.scopes ?? null,
    status: 'active' as const,
    connectedAt: now,
    updatedAt: now,
  };
  await db
    .insert(connectedAccounts)
    .values({ athleteId, provider: 'garmin', providerUserId: tokens.providerUserId, ...values })
    .onConflictDoUpdate({ target: [connectedAccounts.provider, connectedAccounts.providerUserId], set: { athleteId, ...values } });
}

/** A valid access token, refreshing (and persisting the rotated pair) when near expiry. */
export async function ensureGarminAccessToken(db: DB, acct: GarminAccount): Promise<string> {
  const expMs = acct.tokenExpiresAt ? acct.tokenExpiresAt.getTime() : 0;
  if (acct.accessToken && expMs - Date.now() > TOKEN_SKEW_MS) return acct.accessToken;
  if (!acct.refreshToken) throw new Error('Garmin account has no refresh token; reconnect required.');
  const refreshed = await getProvider('garmin').refreshTokens(acct.refreshToken);
  await db
    .update(connectedAccounts)
    .set({
      // Garmin rotates the refresh token on every refresh.
      accessToken: sealToken(refreshed.accessToken),
      refreshToken: sealToken(refreshed.refreshToken ?? acct.refreshToken),
      tokenExpiresAt: refreshed.expiresAt ?? null,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, acct.id));
  return refreshed.accessToken;
}

/** The stable Garmin API user id behind an access token (same across reconnects). */
export async function fetchGarminUserId(accessToken: string): Promise<string> {
  const res = await fetch(`${garminEnv().apiBaseUrl}/wellness-api/rest/user/id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Garmin user id request failed (HTTP ${res.status}).`);
  const j = (await res.json()) as { userId?: string };
  if (!j.userId) throw new Error('Garmin did not return a user id.');
  return j.userId;
}

/**
 * Summary types we normalize, and the backfill path for each. Backfill is
 * asynchronous: Garmin answers 202 and later delivers the history through the
 * normal ping/push webhook. Windows are limited, so history goes in chunks.
 */
export const GARMIN_BACKFILL_TYPES = ['activities', 'dailies', 'sleeps', 'hrv', 'userMetrics', 'bodyComps'] as const;
const BACKFILL_CHUNK_DAYS = 90;

export async function requestGarminBackfill(
  db: DB,
  athleteId: string,
  days: number,
): Promise<{ requested: number; failed: number }> {
  const acct = await getGarminAccount(db, athleteId);
  if (!acct) throw new Error('No Garmin account connected.');
  const token = await ensureGarminAccessToken(db, acct);
  const { apiBaseUrl } = garminEnv();
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  let requested = 0;
  let failed = 0;
  for (let from = start; from < end; from += BACKFILL_CHUNK_DAYS * 86400) {
    const to = Math.min(end, from + BACKFILL_CHUNK_DAYS * 86400);
    for (const type of GARMIN_BACKFILL_TYPES) {
      const url = `${apiBaseUrl}/wellness-api/rest/backfill/${type}?summaryStartTimeInSeconds=${from}&summaryEndTimeInSeconds=${to}`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        // 409 = this window was already requested: fine.
        if (res.ok || res.status === 202 || res.status === 409) requested++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }
  return { requested, failed };
}

/**
 * Remove this app's registration for the user at Garmin. Garmin REQUIRES this
 * when the user disconnects or deletes their account here.
 */
export async function deregisterGarmin(db: DB, acct: GarminAccount): Promise<boolean> {
  try {
    const token = await ensureGarminAccessToken(db, acct);
    const res = await fetch(`${garminEnv().apiBaseUrl}/wellness-api/rest/user/registration`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok || res.status === 204 || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Fetch the summaries a PING notification points at. Only Garmin's own API
 * host is ever fetched (a forged callbackURL must not make us call elsewhere),
 * and with the user's token, so the data returned is authentic.
 */
export async function fetchGarminCallback(db: DB, acct: GarminAccount, callbackURL: string): Promise<unknown[]> {
  const allowed = new URL(garminEnv().apiBaseUrl);
  const u = new URL(callbackURL);
  if (u.protocol !== 'https:' || u.host !== allowed.host) throw new Error('Refusing a non-Garmin callback URL.');
  const token = await ensureGarminAccessToken(db, acct);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Garmin callback fetch failed (HTTP ${res.status}).`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

export interface GarminStatus {
  configured: boolean;
  connected: boolean;
  /** Most recent day with Garmin data, if any has arrived yet. */
  latestDay: string | null;
}

export async function getGarminStatus(db: DB, athleteId: string): Promise<GarminStatus> {
  const { garminConfigured } = await import('@/providers/garmin/env');
  const configured = garminConfigured();
  const [acct] = await db
    .select({ status: connectedAccounts.status })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.athleteId, athleteId), eq(connectedAccounts.provider, 'garmin')))
    .limit(1);
  const connected = acct?.status === 'active';
  if (!connected) return { configured, connected: false, latestDay: null };
  const { dailySummaries } = await import('@/db/schema');
  const { desc } = await import('drizzle-orm');
  const [d] = await db
    .select({ day: dailySummaries.day })
    .from(dailySummaries)
    .where(and(eq(dailySummaries.athleteId, athleteId), eq(dailySummaries.provider, 'garmin')))
    .orderBy(desc(dailySummaries.day))
    .limit(1);
  return { configured, connected, latestDay: d?.day ?? null };
}
