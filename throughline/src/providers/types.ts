/**
 * Provider abstraction. ALL provider-specific code lives behind this interface
 * (today only `providers/garmin`). The rest of the app talks to providers only
 * through these types, so adding Whoop/Oura/Apple later is a new module — not a
 * schema change and not edits scattered across the app.
 */
import type { InferInsertModel } from 'drizzle-orm';
import type {
  activities,
  dailySummaries,
  sleepRecords,
  hrvRecords,
  restingHrRecords,
} from '@/db/schema';

export type ProviderId = 'garmin' | 'strava';

/** OAuth result a provider hands back after a successful connect flow. */
export interface ProviderTokens {
  providerUserId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

/**
 * The normalized rows a provider's normalizer can emit from one raw payload.
 * The caller owns the athlete mapping and the source raw_event link, so the
 * normalizer returns rows without those (or the row id / timestamps).
 *
 * `InferInsertModel` is resolved per-table at the interface so the concrete
 * columns survive — a generic `<T extends Table>` would erase them.
 */
type StripDerived<T> = Omit<T, 'id' | 'athleteId' | 'rawEventId' | 'createdAt'>;

export interface NormalizedBatch {
  activities?: StripDerived<InferInsertModel<typeof activities>>[];
  dailySummaries?: StripDerived<InferInsertModel<typeof dailySummaries>>[];
  sleepRecords?: StripDerived<InferInsertModel<typeof sleepRecords>>[];
  hrvRecords?: StripDerived<InferInsertModel<typeof hrvRecords>>[];
  restingHrRecords?: StripDerived<InferInsertModel<typeof restingHrRecords>>[];
}

/** Verbatim payload as received, before any normalization. */
export interface InboundPayload {
  eventType: string; // 'activities' | 'dailies' | 'sleeps' | ...
  providerUserId?: string;
  payload: unknown;
}

export interface Provider {
  readonly id: ProviderId;

  // --- OAuth ---
  /** URL to send the athlete to in order to authorize. */
  getAuthorizationUrl(state: string): string;
  /** Exchange the OAuth callback code for tokens. */
  exchangeCode(code: string): Promise<ProviderTokens>;
  refreshTokens(refreshToken: string): Promise<ProviderTokens>;

  // --- Webhooks ---
  /** Verify a webhook request is authentic (signature/secret). */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;
  /** Split a webhook body into one InboundPayload per logical event. */
  parseWebhook(rawBody: string): InboundPayload[];

  // --- Backfill ---
  /** Kick off the provider's historical backfill for an athlete. */
  requestBackfill(tokens: ProviderTokens, fromDays: number): Promise<void>;

  // --- Normalization ---
  /** Turn one raw payload into normalized rows. Pure given the payload. */
  normalize(eventType: string, payload: unknown): NormalizedBatch;
}
