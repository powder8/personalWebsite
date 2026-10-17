import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  athletes, activities, users, accounts, sessions, connectedAccounts, rawEvents, feedback,
  rateLimitEvents, verificationTokens, checkIns, sleepRecords,
} from '@/db/schema';
import { deleteAthleteAccount, disconnectProvider } from '../accountDeletion';
import { sealToken } from '../tokenCrypto';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '66666666-6666-4666-8666-666666666666';
const OTHER = '55555555-5555-4555-8555-555555555555';
const realFetch = globalThis.fetch;
const calls: string[] = [];

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'c'.repeat(64);
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readdirSync(join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8')).join('\n--> statement-breakpoint\n');
  for (const s of sql.split('--> statement-breakpoint')) { const t = s.trim(); if (t) await client.exec(t); }

  await db.insert(users).values({ id: 'u-1', name: 'Pat Doe', email: 'pat@example.com' });
  await db.insert(accounts).values({ userId: 'u-1', type: 'oidc', provider: 'google', providerAccountId: 'g-1' });
  await db.insert(sessions).values({ sessionToken: 's-1', userId: 'u-1', expires: new Date(Date.now() + 86400_000) });
  await db.insert(athletes).values([
    { id: A, fullName: 'Pat Doe', email: 'pat@example.com', timezone: 'UTC', userId: 'u-1' },
    { id: OTHER, fullName: 'Someone Else', email: 'else@example.com', timezone: 'UTC' },
  ]);
  const later = new Date(Date.now() + 86400_000);
  await db.insert(connectedAccounts).values([
    { athleteId: A, provider: 'strava', providerUserId: 's-9', accessToken: sealToken('strava-tok'), refreshToken: sealToken('strava-ref'), tokenExpiresAt: later, status: 'active' },
    { athleteId: A, provider: 'whoop', providerUserId: 'w-9', accessToken: sealToken('whoop-tok'), refreshToken: sealToken('whoop-ref'), tokenExpiresAt: later, status: 'active' },
  ]);
  await db.insert(activities).values([
    { athleteId: A, provider: 'strava', sourceRef: 'strava:1', sport: 'run', startTime: new Date(), durationSeconds: 1800 },
    { athleteId: OTHER, provider: 'strava', sourceRef: 'strava:2', sport: 'run', startTime: new Date(), durationSeconds: 1800 },
  ]);
  await db.insert(sleepRecords).values({ athleteId: A, day: '2026-10-16', totalSleepSeconds: 25000 });
  await db.insert(checkIns).values({ athleteId: A, day: '2026-10-16', energy: 7 });
  await db.insert(rawEvents).values({ athleteId: A, provider: 'strava', source: 'webhook', eventType: 'activity', payload: { id: 1 }, payloadHash: 'h1' });
  await db.insert(rateLimitEvents).values({ key: `chat:${A}` });
  await db.insert(verificationTokens).values({ identifier: 'pat@example.com', token: 't', expires: later });
  await db.insert(feedback).values([{ author: 'Pat Doe', body: 'more charts' }, { author: 'Someone Else', body: 'nice' }]);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await client.close();
});

test('disconnect revokes at the provider and forgets the tokens, keeping history', async () => {
  const r = await disconnectProvider(db, A, 'whoop');
  assert.equal(r.revoked, true);
  assert.ok(calls.some((c) => c.endsWith('/developer/v2/user/access')), 'Whoop revoke called');
  const left = await db.select().from(connectedAccounts).where(eq(connectedAccounts.athleteId, A));
  assert.deepEqual(left.map((c) => c.provider), ['strava']);
  assert.equal((await db.select().from(sleepRecords).where(eq(sleepRecords.athleteId, A))).length, 1, 'history stays');
});

test('delete removes the athlete, their data, raw payloads, user, sessions, and sign-in links', async () => {
  const r = await deleteAthleteAccount(db, A);
  assert.equal(r.revoked.strava, true);
  assert.ok(calls.some((c) => c.endsWith('/oauth/deauthorize')), 'Strava deauthorize called');

  assert.equal((await db.select().from(athletes).where(eq(athletes.id, A))).length, 0);
  assert.equal((await db.select().from(activities).where(eq(activities.athleteId, A))).length, 0);
  assert.equal((await db.select().from(sleepRecords)).length, 0);
  assert.equal((await db.select().from(checkIns)).length, 0);
  assert.equal((await db.select().from(rawEvents)).length, 0, 'raw payloads would otherwise survive with a null link');
  assert.equal((await db.select().from(connectedAccounts)).length, 0);
  assert.equal((await db.select().from(users)).length, 0);
  assert.equal((await db.select().from(accounts)).length, 0);
  assert.equal((await db.select().from(sessions)).length, 0);
  assert.equal((await db.select().from(verificationTokens)).length, 0);
  assert.equal((await db.select().from(rateLimitEvents)).length, 0);
  const fb = await db.select().from(feedback);
  assert.deepEqual(fb.map((f) => f.author).sort(), ['Deleted user', 'Someone Else']);
});

test("another athlete's data is untouched", async () => {
  assert.equal((await db.select().from(athletes).where(eq(athletes.id, OTHER))).length, 1);
  assert.equal((await db.select().from(activities).where(eq(activities.athleteId, OTHER))).length, 1);
});
