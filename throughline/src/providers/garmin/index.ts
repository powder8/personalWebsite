/**
 * Garmin provider (Garmin Connect Developer Program: Health + Activity APIs).
 * OAuth 2.0 PKCE per Garmin's spec; webhooks in ping or push mode; pure
 * normalizers. Token storage, refresh, backfill, and deregistration live in
 * server/garmin.ts. All endpoints and secrets come from env (garminEnv).
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type {
  Provider,
  ProviderTokens,
  InboundPayload,
  NormalizedBatch,
} from '../types';
import { garminEnv } from './env';

/**
 * PKCE verifier for a given OAuth `state`, derived (HMAC) rather than stored:
 * the callback re-derives it from the state it already verified, so there is
 * no second cookie or table. 43 chars of base64url, inside PKCE's 43–128.
 */
export function pkceVerifier(state: string, secret: string): string {
  return createHmac('sha256', secret).update(`garmin-pkce:${state}`).digest('base64url');
}
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

interface GarminTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // seconds (24 h)
  refresh_token_expires_in?: number; // seconds (~90 d)
  scope?: string;
}

/** Garmin recommends treating tokens as expiring 10 minutes early. */
const EXPIRY_SKEW_SEC = 600;

function toTokens(j: GarminTokenResponse): ProviderTokens {
  return {
    providerUserId: '', // filled from /user/id by the caller
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_in ? new Date(Date.now() + (j.expires_in - EXPIRY_SKEW_SEC) * 1000) : undefined,
    scopes: j.scope ? j.scope.split(' ') : undefined,
  };
}

async function tokenRequest(body: Record<string, string>): Promise<ProviderTokens> {
  const { tokenUrl, clientId, clientSecret } = garminEnv();
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Garmin token request failed (HTTP ${res.status}).`);
  return toTokens((await res.json()) as GarminTokenResponse);
}

export const garmin: Provider = {
  id: 'garmin',

  // --- OAuth 2.0 PKCE (Garmin Connect Developer Program spec) ---
  getAuthorizationUrl(state: string): string {
    const { authorizeUrl, clientId, redirectUri } = garminEnv();
    const secret = process.env.AUTH_SECRET || 'throughline-dev-oauth-secret';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: pkceChallenge(pkceVerifier(state, secret)),
      code_challenge_method: 'S256',
    });
    return `${authorizeUrl}?${params.toString()}`;
  },

  async exchangeCode(code: string, opts?: { codeVerifier?: string }): Promise<ProviderTokens> {
    if (!opts?.codeVerifier) throw new Error('Garmin token exchange needs the PKCE verifier.');
    const { redirectUri } = garminEnv();
    return tokenRequest({ grant_type: 'authorization_code', code, code_verifier: opts.codeVerifier, redirect_uri: redirectUri });
  },

  async refreshTokens(refreshToken: string): Promise<ProviderTokens> {
    return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  },

  // --- Webhooks ---
  // Garmin doesn't sign notifications, so the registered URL carries a shared
  // secret (?key=…). Ping data is additionally fetched from Garmin with the
  // user's own token, which authenticates the data itself. Fails closed.
  async verifyWebhook(req: Request): Promise<boolean> {
    const secret = garminEnv().webhookSecret;
    if (!secret) return false;
    const provided = new URL(req.url).searchParams.get('key') ?? '';
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(secret).digest();
    return timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: string): InboundPayload[] {
    // Garmin batches records per summary type:
    //   { "dailies": [...], "activities": [...], "deregistrations": [...] }
    // A PING record carries { userId, callbackURL } and no data; a PUSH record
    // is the summary itself (with userId).
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const out: InboundPayload[] = [];
    for (const [eventType, records] of Object.entries(body)) {
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        const r = record as Record<string, unknown>;
        out.push({
          eventType,
          providerUserId: (r.userId as string | undefined) ?? undefined,
          payload: record,
        });
      }
    }
    return out;
  },

  // --- Backfill (see server/garmin.ts: needs the athlete's live token) ---
  async requestBackfill(): Promise<void> {
    throw new Error('Use requestGarminBackfill in server/garmin.ts.');
  },

  // --- Normalization (pure: payload -> normalized rows) ---
  normalize(eventType: string, payload: unknown): NormalizedBatch {
    const p = payload as Record<string, unknown>;
    switch (eventType) {
      case 'activities':
        return {
          activities: [
            {
              sport: mapSport(p.activityType as string | undefined),
              name: (p.activityName as string | undefined) ?? null,
              startTime: new Date(((p.startTimeInSeconds as number) ?? 0) * 1000),
              durationSeconds: (p.durationInSeconds as number) ?? 0,
              elapsedSeconds: (p.durationInSeconds as number) ?? null,
              elevationGainMeters: (p.totalElevationGainInMeters as number) ?? null,
              distanceMeters: (p.distanceInMeters as number) ?? null,
              avgHr: (p.averageHeartRateInBeatsPerMinute as number) ?? null,
              maxHr: (p.maxHeartRateInBeatsPerMinute as number) ?? null,
              avgPaceSecPerKm: paceFromSpeed(p.averageSpeedInMetersPerSecond as number | undefined),
              cadence: (p.averageRunCadenceInStepsPerMinute as number) ?? null,
              trainingLoad: null, // derived later by the load model, not from Garmin
              splits: null,
              sourceRef: garminSourceRef(p.summaryId ?? p.activityId),
            },
          ],
        };
      case 'dailies': {
        const day = isoDay(p.calendarDate as string | undefined, p.startTimeInSeconds as number);
        const restingHr = (p.restingHeartRateInBeatsPerMinute as number) ?? null;
        return {
          dailySummaries: [
            {
              day,
              steps: (p.steps as number) ?? null,
              restingHr,
              avgStressLevel: (p.averageStressLevel as number) ?? null,
              bodyBatteryLow: (p.bodyBatteryLowestValue as number) ?? null,
              bodyBatteryHigh: (p.bodyBatteryHighestValue as number) ?? null,
              metrics: p,
            },
          ],
          // Also emit a resting-HR record so it feeds readiness/baselines (which
          // read restingHrRecords, not dailySummaries).
          ...(restingHr != null ? { restingHrRecords: [{ day, restingHr }] } : {}),
        };
      }
      case 'sleeps':
        return {
          sleepRecords: [
            {
              day: isoDay(p.calendarDate as string | undefined, p.startTimeInSeconds as number),
              totalSleepSeconds: (p.durationInSeconds as number) ?? null,
              deepSeconds: (p.deepSleepDurationInSeconds as number) ?? null,
              remSeconds: (p.remSleepInSeconds as number) ?? null,
              lightSeconds: (p.lightSleepDurationInSeconds as number) ?? null,
              awakeSeconds: (p.awakeDurationInSeconds as number) ?? null,
              sleepScore: null,
              metrics: p,
            },
          ],
        };
      case 'userMetrics': {
        // Garmin's User Metrics summary: a device-MEASURED VO2max, reported
        // separately for running and cycling (they legitimately differ, and
        // cycling is typically the lower of the two).
        const day = isoDay(p.calendarDate as string | undefined, p.startTimeInSeconds as number);
        const running = (p.vo2Max as number) ?? null;
        const cycling = (p.vo2MaxCycling as number) ?? null;
        if (running == null && cycling == null) return {};
        return {
          dailySummaries: [
            { day, vo2maxRunning: running, vo2maxCycling: cycling, metrics: p },
          ],
        };
      }
      case 'bodyComps': {
        // Garmin Body Composition summary (a Withings scale synced to Garmin
        // Connect lands here): weight in grams, body fat %, and a BMI Garmin
        // computes from the profile height. Stored on the day it was measured.
        const day = isoDay(p.calendarDate as string | undefined, (p.measurementTimeInSeconds ?? p.startTimeInSeconds) as number);
        const grams = p.weightInGrams as number | undefined;
        const weightKg = grams != null && grams > 0 ? Math.round(grams / 10) / 100 : null;
        const bodyFatPct = (p.bodyFatInPercent as number) ?? null;
        const bmi = (p.bodyMassIndex as number) ?? null;
        if (weightKg == null && bodyFatPct == null && bmi == null) return {};
        return { dailySummaries: [{ day, weightKg, bodyFatPct, bmi, metrics: p }] };
      }
      case 'hrv':
        // Garmin HRV summary: overnight average in ms (`lastNightAvg`), plus a
        // 5-min values map we keep in metrics for later.
        return {
          hrvRecords: [
            {
              day: isoDay(p.calendarDate as string | undefined, p.startTimeInSeconds as number),
              overnightAvgMs:
                (p.lastNightAvg as number) ?? (p.lastNightAvgHrv as number) ?? null,
              metrics: p,
            },
          ],
        };
      default:
        return {};
    }
  },
};

// --- helpers ---

function mapSport(garminType: string | undefined): 'run' | 'bike' | 'swim' | 'strength' | 'cross_train' | 'other' {
  const t = (garminType ?? '').toUpperCase();
  if (/SWIM/.test(t)) return 'swim';
  if (/RUN/.test(t)) return 'run'; // RUNNING, TRAIL_RUNNING, TREADMILL_RUNNING, ULTRA_RUN…
  if (/CYCL|BIK|RIDE|SPIN/.test(t)) return 'bike'; // CYCLING, ROAD_BIKING, INDOOR_CYCLING, VIRTUAL_RIDE, MOUNTAIN_BIKING, GRAVEL_CYCLING…
  if (/STRENGTH|HIIT|PILATES/.test(t)) return 'strength';
  if (/WALK|HIK|ROW|ELLIPTICAL|STAIR|SKI|PADDL|CLIMB/.test(t)) return 'cross_train';
  return 'other';
}

function garminSourceRef(id: unknown): string | null {
  return id != null ? `garmin:${id}` : null;
}

function paceFromSpeed(metersPerSecond: number | undefined): number | null {
  if (!metersPerSecond || metersPerSecond <= 0) return null;
  return 1000 / metersPerSecond; // seconds per km
}

function isoDay(calendarDate: string | undefined, startTimeInSeconds: number | undefined): string {
  if (calendarDate) return calendarDate; // already YYYY-MM-DD
  const ms = (startTimeInSeconds ?? 0) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
