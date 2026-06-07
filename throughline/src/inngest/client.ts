import { Inngest } from 'inngest';

/**
 * Inngest decouples webhook ingestion from normalization: the webhook route
 * writes a RawEvent and emits an event, returning fast; normalization runs as a
 * durable background step with retries. Keeps Garmin's webhook latency budget
 * happy and makes re-derivation a matter of re-emitting events.
 */
export const inngest = new Inngest({ id: 'throughline' });

/** Event names — keep them centralized so producers/consumers stay in sync. */
export const events = {
  rawEventReceived: 'throughline/raw-event.received',
  morningRun: 'throughline/morning.run',
} as const;
