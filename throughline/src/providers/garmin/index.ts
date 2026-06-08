/**
 * Garmin provider (Garmin Connect Developer Program / Health & Activity API).
 *
 * STATUS: scaffold. The plumbing (verify → parse → normalize shape) is real and
 * wired; the marked spots need the live Garmin API once Developer Program access
 * is granted (see Phase 0.5 TODOs in README). Build against Garmin's EVALUATION
 * environment first — all endpoints/secrets come from env, never hard-coded.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  Provider,
  ProviderTokens,
  InboundPayload,
  NormalizedBatch,
} from '../types';
import { garminEnv } from './env';

export const garmin: Provider = {
  id: 'garmin',

  // --- OAuth (Garmin uses OAuth2 PKCE in the Health API) ---
  getAuthorizationUrl(state: string): string {
    const { authBaseUrl, clientId, redirectUri } = garminEnv();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
    return `${authBaseUrl}/oauth-service/oauth/authorize?${params.toString()}`;
  },

  async exchangeCode(_code: string): Promise<ProviderTokens> {
    // TODO(garmin): POST to token endpoint with code + PKCE verifier, map the
    // response to ProviderTokens. Requires Developer Program credentials.
    throw new Error('garmin.exchangeCode: not yet implemented (awaiting Garmin Developer access)');
  },

  async refreshTokens(_refreshToken: string): Promise<ProviderTokens> {
    // TODO(garmin): refresh grant.
    throw new Error('garmin.refreshTokens: not yet implemented');
  },

  // --- Webhooks ---
  async verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
    const secret = garminEnv().webhookSecret;
    if (!secret) return false;
    // Garmin "ping" webhooks can be verified via a shared secret / signature
    // header. Adjust the header name to match the program config.
    const provided = req.headers.get('x-garmin-signature') ?? '';
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: string): InboundPayload[] {
    // Garmin push webhooks batch records per type:
    //   { "activities": [...], "dailies": [...], "sleeps": [...] }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const out: InboundPayload[] = [];
    for (const [eventType, records] of Object.entries(body)) {
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        const r = record as Record<string, unknown>;
        out.push({
          eventType,
          providerUserId:
            (r.userId as string | undefined) ?? (r.userAccessToken as string | undefined),
          payload: record,
        });
      }
    }
    return out;
  },

  // --- Backfill ---
  async requestBackfill(_tokens: ProviderTokens, _fromDays: number): Promise<void> {
    // TODO(garmin): hit the backfill endpoints (activities/dailies/sleeps) for
    // the historical window so baselines and load state are warm from day one.
    throw new Error('garmin.requestBackfill: not yet implemented');
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
              startTime: new Date(((p.startTimeInSeconds as number) ?? 0) * 1000),
              durationSeconds: (p.durationInSeconds as number) ?? 0,
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

function mapSport(garminType: string | undefined): 'run' | 'bike' | 'swim' | 'other' {
  switch ((garminType ?? '').toUpperCase()) {
    case 'RUNNING':
    case 'TRAIL_RUNNING':
    case 'TREADMILL_RUNNING':
      return 'run';
    case 'CYCLING':
    case 'ROAD_BIKING':
      return 'bike';
    case 'LAP_SWIMMING':
    case 'OPEN_WATER_SWIMMING':
      return 'swim';
    default:
      return 'other';
  }
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
