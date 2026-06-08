/**
 * Strava provider (OAuth2 + Activities API + push webhooks).
 *
 * Unlike Garmin, Strava is fully self-serve: register an app at
 * https://www.strava.com/settings/api, set the env vars (see strava/env.ts),
 * and the connect flow + pull sync work end-to-end. Webhooks carry only IDs, so
 * the webhook route fetches the activity and runs it through `normalize` — the
 * same code path the pull sync uses.
 */
import type { Provider, ProviderTokens, InboundPayload, NormalizedBatch } from '../types';
import { stravaEnv } from './env';

/** Shape of the fields we read from a Strava activity (summary or detail). */
export interface StravaActivity {
  id: number | string;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date?: string; // ISO 8601 UTC
  elapsed_time?: number; // seconds
  moving_time?: number; // seconds
  distance?: number; // meters
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number; // m/s
  average_cadence?: number; // per-leg rpm for runs (×2 for steps/min)
  total_elevation_gain?: number; // meters of ascent
  workout_type?: number; // runs: 0 default, 1 race, 2 long run, 3 workout
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number };
}

export const strava: Provider = {
  id: 'strava',

  // --- OAuth ---
  getAuthorizationUrl(state: string): string {
    const { authBaseUrl, clientId, redirectUri } = stravaEnv();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      approval_prompt: 'auto',
      // read_all covers private activities; activity:read_all for full history.
      scope: 'read,activity:read_all',
      state,
    });
    return `${authBaseUrl}/oauth/authorize?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<ProviderTokens> {
    const { authBaseUrl, clientId, clientSecret } = stravaEnv();
    const res = await fetch(`${authBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`strava token exchange failed (HTTP ${res.status})`);
    const j = (await res.json()) as TokenResponse;
    return {
      providerUserId: String(j.athlete?.id ?? ''),
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: new Date(j.expires_at * 1000),
      scopes: ['read', 'activity:read_all'],
    };
  },

  async refreshTokens(refreshToken: string): Promise<ProviderTokens> {
    const { authBaseUrl, clientId, clientSecret } = stravaEnv();
    const res = await fetch(`${authBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`strava token refresh failed (HTTP ${res.status})`);
    const j = (await res.json()) as TokenResponse;
    return {
      providerUserId: '', // refresh response carries no athlete; caller keeps the existing id
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: new Date(j.expires_at * 1000),
    };
  },

  // --- Webhooks ---
  async verifyWebhook(_req: Request, rawBody: string): Promise<boolean> {
    // Strava POSTs are unsigned; when a subscription id is configured, require
    // it to match. Otherwise accept (the callback URL is the shared secret).
    const { subscriptionId } = stravaEnv();
    if (!subscriptionId) return true;
    try {
      const body = JSON.parse(rawBody) as { subscription_id?: number | string };
      return String(body.subscription_id ?? '') === String(subscriptionId);
    } catch {
      return false;
    }
  },

  parseWebhook(rawBody: string): InboundPayload[] {
    // Strava sends ONE event object per POST: { object_type, object_id,
    // aspect_type, owner_id, ... }. It carries no activity data — the route
    // fetches the activity by id. We surface it as an 'activity_event'.
    const e = JSON.parse(rawBody) as {
      object_type?: string;
      object_id?: number;
      aspect_type?: string;
      owner_id?: number;
    };
    if (e.object_type !== 'activity') return [];
    return [
      {
        eventType: 'activity_event',
        providerUserId: e.owner_id != null ? String(e.owner_id) : undefined,
        payload: e,
      },
    ];
  },

  async requestBackfill(): Promise<void> {
    // Strava backfill is a pull (athlete/activities), implemented in
    // server/strava.ts where it has DB + token access. No webhook to request.
  },

  // --- Normalization (pure) ---
  normalize(eventType: string, payload: unknown): NormalizedBatch {
    if (eventType !== 'activity') return {};
    return { activities: [normalizeActivity(payload as StravaActivity)] };
  },
};

// --- helpers (exported for tests) ---

export function normalizeActivity(a: StravaActivity): NonNullable<NormalizedBatch['activities']>[number] {
  const sport = mapSport(a.sport_type ?? a.type);
  const isRun = sport === 'run';
  return {
    sport,
    name: a.name ?? null,
    workoutType: a.workout_type ?? null,
    startTime: a.start_date ? new Date(a.start_date) : new Date(0),
    durationSeconds: a.moving_time ?? a.elapsed_time ?? null,
    distanceMeters: a.distance ?? null,
    avgHr: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
    maxHr: a.max_heartrate != null ? Math.round(a.max_heartrate) : null,
    avgPaceSecPerKm: paceFromSpeed(a.average_speed),
    elevationGainMeters: a.total_elevation_gain ?? null,
    cadence:
      a.average_cadence != null ? Math.round(a.average_cadence * (isRun ? 2 : 1)) : null,
    trainingLoad: null, // derived later by the load model
    splits: null,
    sourceRef: `strava:${a.id}`,
  };
}

export function mapSport(t: string | undefined): 'run' | 'bike' | 'swim' | 'other' {
  switch ((t ?? '').toLowerCase()) {
    case 'run':
    case 'trailrun':
    case 'virtualrun':
      return 'run';
    case 'ride':
    case 'virtualride':
    case 'ebikeride':
    case 'gravelride':
    case 'mountainbikeride':
      return 'bike';
    case 'swim':
    case 'virtualswim':
      return 'swim';
    default:
      return 'other';
  }
}

function paceFromSpeed(metersPerSecond: number | undefined): number | null {
  if (!metersPerSecond || metersPerSecond <= 0) return null;
  return 1000 / metersPerSecond; // seconds per km
}
