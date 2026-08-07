/**
 * PURE OAuth `state` CSRF logic (no server-only, no env — testable).
 *
 * The connect route mints a random nonce and a cookie value that binds the
 * nonce to the athlete with an HMAC. The `state` sent to the provider is JUST
 * the nonce. The callback re-reads the cookie, checks the nonce matches the
 * returned `state`, verifies the HMAC, and only then trusts the athleteId —
 * which it takes from the (signed) cookie, never from the query. An attacker
 * cannot forge a cookie for a victim's browser, so they cannot bind their
 * provider account to someone else's athlete, nor drive the callback at all.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export function signState(secret: string, nonce: string, athleteId: string): string {
  return createHmac('sha256', secret).update(`${nonce}:${athleteId}`).digest('hex');
}

/** Mint a fresh state nonce + the cookie value binding it to the athlete. */
export function issueState(secret: string, athleteId: string): { state: string; cookieValue: string } {
  const nonce = randomUUID();
  return { state: nonce, cookieValue: `${nonce}:${athleteId}:${signState(secret, nonce, athleteId)}` };
}

/** The bound athleteId iff the callback `state` matches the signed cookie; else null. */
export function verifyState(secret: string, stateParam: string | null, cookieValue: string | undefined): string | null {
  if (!stateParam || !cookieValue) return null;
  const parts = cookieValue.split(':');
  if (parts.length !== 3) return null;
  const [nonce, athleteId, sig] = parts;
  if (!nonce || !athleteId || nonce !== stateParam) return null;
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(signState(secret, nonce, athleteId), 'hex');
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return athleteId;
}
