/**
 * Capability token for the iCal feed. Calendar apps (Apple, Google, Outlook)
 * fetch a subscribed feed from THEIR servers with no session cookie, so the
 * feed URL itself has to carry the authorization. The token is an HMAC of the
 * athlete id under AUTH_SECRET: unguessable, stable (the subscription keeps
 * working), and verifiable without a DB lookup. Rotating AUTH_SECRET revokes
 * every feed link.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function key(): string | null {
  return process.env.AUTH_SECRET || null;
}

export function calendarToken(athleteId: string): string | null {
  const k = key();
  if (!k) return null;
  return createHmac('sha256', k).update(`ics:v1:${athleteId}`).digest('base64url').slice(0, 32);
}

export function verifyCalendarToken(athleteId: string, token: string | null | undefined): boolean {
  const expected = calendarToken(athleteId);
  if (!expected || !token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
