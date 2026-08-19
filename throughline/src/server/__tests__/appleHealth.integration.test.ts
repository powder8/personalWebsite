/**
 * Apple Health push ingest — token auth, normalize → persist, idempotent replays,
 * and token rotation invalidating the old token.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, hrvRecords, restingHrRecords, sleepRecords } from '@/db/schema';
import {
  rotateAppleHealthToken,
  findAthleteIdByAppleToken,
  ingestAppleHealth,
  getAppleHealthStatus,
} from '../appleHealth';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '55555555-5555-4555-5555-555555555555';

const PAYLOAD = {
  data: {
    metrics: [
      { name: 'heart_rate_variability', units: 'ms', data: [{ date: '2026-08-18 03:00:00 +0000', qty: 62 }] },
      { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-08-18 03:00:00 +0000', qty: 49 }] },
      { name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-08-18 07:00:00 +0000', asleep: 7.2, deep: 1.1, rem: 1.4, core: 4.7 }] },
    ],
  },
};

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readdirSync(join(process.cwd(), 'drizzle'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8'))
    .join('\n--> statement-breakpoint\n');
  for (const s of sql.split('--> statement-breakpoint')) {
    const t = s.trim();
    if (t) await client.exec(t);
  }
  await db.insert(athletes).values({ id: A, fullName: 'HealthKit User', email: 'hk@example.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

test('a generated token resolves to its athlete; garbage does not', async () => {
  const token = await rotateAppleHealthToken(db, A);
  assert.ok(token.length >= 32, 'high-entropy token');
  assert.equal(await findAthleteIdByAppleToken(db, token), A);
  assert.equal(await findAthleteIdByAppleToken(db, 'nope'), null);
  assert.equal(await findAthleteIdByAppleToken(db, ''), null);
  assert.equal((await getAppleHealthStatus(db, A)).connected, true);
});

test('ingest normalizes + persists HRV, resting HR, and sleep, tagged apple', async () => {
  const res = await ingestAppleHealth(db, A, PAYLOAD);
  assert.deepEqual(res, { hrv: 1, restingHr: 1, sleep: 1, duplicate: false, rateLimited: false });

  const [hrv] = await db.select().from(hrvRecords).where(and(eq(hrvRecords.athleteId, A), eq(hrvRecords.day, '2026-08-18')));
  assert.equal(hrv.overnightAvgMs, 62);
  assert.equal(hrv.provider, 'apple');

  const [rhr] = await db.select().from(restingHrRecords).where(and(eq(restingHrRecords.athleteId, A), eq(restingHrRecords.day, '2026-08-18')));
  assert.equal(rhr.restingHr, 49);
  assert.equal(rhr.provider, 'apple');

  const [sleep] = await db.select().from(sleepRecords).where(and(eq(sleepRecords.athleteId, A), eq(sleepRecords.day, '2026-08-18')));
  assert.equal(sleep.totalSleepSeconds, Math.round(7.2 * 3600));
  assert.equal(sleep.provider, 'apple');
});

test('re-posting the same payload is idempotent (no duplicate rows)', async () => {
  const res = await ingestAppleHealth(db, A, PAYLOAD);
  assert.equal(res.duplicate, true);
  const rows = await db.select().from(hrvRecords).where(eq(hrvRecords.athleteId, A));
  assert.equal(rows.length, 1, 'still one HRV row for the day');
});

test('ingest is rate-limited per athlete over the window', async () => {
  const B = '55555555-5555-4555-5555-5555555555bb';
  await db.insert(athletes).values({ id: B, fullName: 'Chatty Exporter', email: 'chatty@example.com', timezone: 'UTC' });
  const rate = { maxPerWindow: 2, windowMs: 10 * 60 * 1000 };

  // Distinct payloads so each stores a raw event and counts toward the limit.
  const day = (d: string) => ({ data: { metrics: [{ name: 'resting_heart_rate', data: [{ date: d, qty: 50 }] }] } });
  const r1 = await ingestAppleHealth(db, B, day('2026-08-15'), rate);
  const r2 = await ingestAppleHealth(db, B, day('2026-08-16'), rate);
  assert.equal(r1.rateLimited, false);
  assert.equal(r2.rateLimited, false);

  // Third distinct push in the window is rejected and persists nothing.
  const r3 = await ingestAppleHealth(db, B, day('2026-08-17'), rate);
  assert.equal(r3.rateLimited, true);
  const rows = await db.select().from(restingHrRecords).where(eq(restingHrRecords.athleteId, B));
  assert.equal(rows.length, 2, 'the rate-limited push did not persist');
});

test('rotating the token invalidates the previous one', async () => {
  const first = await rotateAppleHealthToken(db, A);
  const second = await rotateAppleHealthToken(db, A);
  assert.notEqual(first, second);
  assert.equal(await findAthleteIdByAppleToken(db, first), null, 'old token no longer resolves');
  assert.equal(await findAthleteIdByAppleToken(db, second), A);
});
