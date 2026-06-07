import { createHash } from 'crypto';

/** Stable hash of a raw payload, for idempotent webhook dedup. */
export function payloadHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
