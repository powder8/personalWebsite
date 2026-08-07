/**
 * Whoop OAuth + API client. Whoop exposes HRV, resting HR, sleep, and recovery
 * scores — not activities — so this module is NOT wired through the Provider
 * registry (which is activity-centric). Instead the connect/callback routes and
 * server/whoop.ts call these helpers directly.
 *
 * API reference: https://developer.whoop.com/api
 */
import { whoopEnv } from './env';

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export interface WhoopTokens {
  providerUserId: string; // Whoop user_id as a string
  accessToken: string;
  refreshToken: string;
  expiresAt: Date; // computed from expires_in
  scopes: string[];
}

interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
  scope?: string;
  token_type: string;
}

async function parseTokenResponse(res: Response): Promise<Omit<WhoopTokens, 'providerUserId'>> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whoop token request failed (HTTP ${res.status}): ${body}`);
  }
  const data = (await res.json()) as RawTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scopes: data.scope ? data.scope.split(' ') : [],
  };
}

// The scopes registered on the WHOOP app. `offline` is required to receive a
// refresh token; `read:profile` is required for the /user/profile/basic call we
// make during the OAuth exchange to capture the WHOOP user_id.
const WHOOP_SCOPES = 'read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement offline';

export function getAuthorizationUrl(state: string): string {
  const { clientId, redirectUri, authBaseUrl } = whoopEnv();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: WHOOP_SCOPES,
    state,
  });
  return `${authBaseUrl}/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<WhoopTokens> {
  const { clientId, clientSecret, redirectUri, authBaseUrl } = whoopEnv();
  const res = await fetch(`${authBaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });
  const tokens = await parseTokenResponse(res);
  const profile = await fetchProfile(tokens.accessToken);
  return { ...tokens, providerUserId: String(profile.user_id) };
}

export async function refreshTokens(refreshToken: string): Promise<WhoopTokens> {
  const { clientId, clientSecret, authBaseUrl } = whoopEnv();
  const res = await fetch(`${authBaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const tokens = await parseTokenResponse(res);
  // The user_id doesn't change on refresh — we don't need a profile call,
  // but we need to return the type with a placeholder; callers use existing
  // providerUserId from the DB.
  return { ...tokens, providerUserId: '' };
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export interface WhoopProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface WhoopRecovery {
  cycle_id: number; // cycles stay integer ids in v2
  sleep_id: string; // v2: sleep ids are UUIDs
  user_id: number;
  created_at: string; // ISO-8601 UTC — the wake-up morning date
  updated_at: string;
  score_state: string; // 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'
  score?: {
    user_calibrating: boolean;
    recovery_score: number; // 0-100
    resting_heart_rate: number; // bpm
    hrv_rmssd_milli: number; // HRV in ms
    spo2_percentage: number | null;
    skin_temp_celsius: number | null;
  } | null;
}

export interface WhoopSleep {
  id: string; // v2: sleep ids are UUIDs
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string; // ISO-8601 UTC
  end: string; // ISO-8601 UTC — use the date portion as the "day"
  timezone_offset: string;
  nap: boolean;
  score_state: string;
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate: number | null;
    sleep_performance_percentage: number | null;
    sleep_consistency_percentage: number | null;
    sleep_efficiency_percentage: number | null;
  } | null;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function fetchProfile(token: string): Promise<WhoopProfile> {
  const { apiBaseUrl } = whoopEnv();
  const res = await fetch(`${apiBaseUrl}/user/profile/basic`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Whoop profile fetch failed (HTTP ${res.status})`);
  return res.json() as Promise<WhoopProfile>;
}

interface CollectionResponse<T> {
  records: T[];
  next_token?: string | null;
}

async function fetchAll<T>(
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const { apiBaseUrl } = whoopEnv();
  const records: T[] = [];
  let nextToken: string | null = null;

  do {
    const qs = new URLSearchParams({
      ...params,
      limit: '25',
      ...(nextToken ? { nextToken } : {}),
    });
    const res = await fetch(`${apiBaseUrl}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Whoop ${path} fetch failed (HTTP ${res.status})`);
    const body = (await res.json()) as CollectionResponse<T>;
    records.push(...body.records);
    nextToken = body.next_token ?? null;
  } while (nextToken);

  return records;
}

/** Fetch recovery records for a date range (ISO-8601 strings, UTC). */
export async function fetchRecoveries(
  token: string,
  startISO: string,
  endISO: string,
): Promise<WhoopRecovery[]> {
  return fetchAll<WhoopRecovery>(token, '/recovery', {
    start: startISO,
    end: endISO,
  });
}

/** Fetch sleep records for a date range. Excludes naps. */
export async function fetchSleepRecords(
  token: string,
  startISO: string,
  endISO: string,
): Promise<WhoopSleep[]> {
  // v2: sleep lives under /activity/sleep (v1 was /sleep).
  const all = await fetchAll<WhoopSleep>(token, '/activity/sleep', { start: startISO, end: endISO });
  return all.filter((s) => !s.nap);
}
