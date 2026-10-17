/**
 * Disconnecting a provider and deleting an athlete's account.
 *
 * Disconnect: revoke our access at the provider (Strava deauthorize, Whoop
 * revoke, Garmin deregistration, which Garmin requires), then forget the
 * tokens. Synced history stays; deleting the account removes it.
 *
 * Delete: disconnect everything, then remove the athlete row (every training,
 * health, and plan table cascades from it), the raw provider payloads (which
 * only null their link), the sign-in user and its sessions, pending sign-in
 * links, rate-limit rows, and the athlete's name on feedback they sent.
 */
import { and, eq, inArray, like, or } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, connectedAccounts, feedback, rateLimitEvents, rawEvents, users, verificationTokens } from '@/db/schema';
import { stravaEnv } from '@/providers/strava/env';
import { whoopEnv } from '@/providers/whoop/env';
import { ensureStravaAccessToken, getStravaAccount } from './strava';
import { ensureWhoopAccessToken, getWhoopAccount } from './whoop';
import { deregisterGarmin, getGarminAccount } from './garmin';

export type DisconnectableProvider = 'strava' | 'whoop' | 'garmin';
export const DISCONNECTABLE: DisconnectableProvider[] = ['strava', 'whoop', 'garmin'];

/** Revoke at the provider (best-effort), then drop the connection row. */
export async function disconnectProvider(db: DB, athleteId: string, provider: DisconnectableProvider): Promise<{ revoked: boolean }> {
  let revoked = false;
  try {
    if (provider === 'strava') {
      const acct = await getStravaAccount(db, athleteId);
      if (acct) {
        const token = await ensureStravaAccessToken(db, acct);
        const res = await fetch(`${stravaEnv().authBaseUrl}/oauth/deauthorize`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ access_token: token }),
        });
        revoked = res.ok;
      }
    } else if (provider === 'whoop') {
      const acct = await getWhoopAccount(db, athleteId);
      if (acct) {
        const token = await ensureWhoopAccessToken(db, acct);
        const res = await fetch(`${whoopEnv().apiBaseUrl}/user/access`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        revoked = res.ok || res.status === 204;
      }
    } else {
      const acct = await getGarminAccount(db, athleteId);
      if (acct) revoked = await deregisterGarmin(db, acct);
    }
  } catch {
    /* the provider may already have revoked us; forget the tokens anyway */
  }
  await db
    .delete(connectedAccounts)
    .where(and(eq(connectedAccounts.athleteId, athleteId), eq(connectedAccounts.provider, provider)));
  return { revoked };
}

export interface DeletionResult {
  revoked: Partial<Record<DisconnectableProvider, boolean>>;
}

export async function deleteAthleteAccount(db: DB, athleteId: string): Promise<DeletionResult> {
  const [athlete] = await db
    .select({ id: athletes.id, userId: athletes.userId, email: athletes.email, fullName: athletes.fullName })
    .from(athletes)
    .where(eq(athletes.id, athleteId))
    .limit(1);
  if (!athlete) throw new Error('Account not found.');

  const connected = await db
    .select({ provider: connectedAccounts.provider })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.athleteId, athleteId));
  const revoked: DeletionResult['revoked'] = {};
  for (const { provider } of connected) {
    if ((DISCONNECTABLE as string[]).includes(provider)) {
      revoked[provider as DisconnectableProvider] = (await disconnectProvider(db, athleteId, provider as DisconnectableProvider)).revoked;
    }
  }

  let userEmail: string | null = null;
  let userName: string | null = null;
  if (athlete.userId) {
    const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, athlete.userId)).limit(1);
    userEmail = u?.email ?? null;
    userName = u?.name ?? null;
  }

  await db.delete(rawEvents).where(eq(rawEvents.athleteId, athleteId));
  await db.delete(rateLimitEvents).where(like(rateLimitEvents.key, `%:${athleteId}`));
  // Cascades every athlete-scoped table (activities, health, plans, check-ins…).
  await db.delete(athletes).where(eq(athletes.id, athleteId));
  if (athlete.userId) await db.delete(users).where(eq(users.id, athlete.userId)); // cascades accounts + sessions

  const emails = [...new Set([athlete.email, userEmail].filter((e): e is string => !!e))];
  if (emails.length) await db.delete(verificationTokens).where(inArray(verificationTokens.identifier, emails));
  // Keep the product feedback, but not who sent it.
  const authors = [...new Set([userName, userEmail, athlete.email].filter((a): a is string => !!a))];
  if (authors.length) {
    await db.update(feedback).set({ author: 'Deleted user' }).where(or(...authors.map((a) => eq(feedback.author, a))));
  }
  return { revoked };
}
