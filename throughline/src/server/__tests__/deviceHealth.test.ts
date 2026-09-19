import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { athletes, activities, sleepRecords, hrvRecords, restingHrRecords, dailySummaries, rawEvents, connectedAccounts } from '@/db/schema';
import { validateDevicePayload, toNormalizedBatch, isSameWorkout, MAX_DAYS } from '../deviceHealthLogic';
import { ingestDeviceHealth } from '../deviceHealth';
import { persistNormalizedBatch, supersedeDeviceWorkouts } from '../ingest';

const TODAY = '2026-09-19';

// ---- validation -------------------------------------------------------------

test('rejects the shapes a broken client could send', () => {
  const bad = (raw: unknown) => {
    const r = validateDevicePayload(raw);
    assert.equal(r.ok, false);
    return r.ok ? '' : r.error;
  };
  assert.match(bad(null), /JSON object/);
  assert.match(bad({ source: 'fitbit', days: [] }), /source/);
  assert.match(bad({ source: 'healthkit' }), /Nothing to ingest/);
  assert.match(bad({ source: 'healthkit', days: [{ day: '9/18/2026' }] }), /YYYY-MM-DD/);
  assert.match(bad({ source: 'healthkit', days: [{ day: '2026-09-18', sleep: {} }] }), /totalSeconds/);
  assert.match(bad({ source: 'healthkit', workouts: [{ start: 'x', sport: 'run', durationSeconds: 100 }] }), /sourceRef/);
  assert.match(bad({ source: 'healthkit', workouts: [{ sourceRef: 'a', start: 'yesterday', sport: 'run', durationSeconds: 100 }] }), /ISO-8601/);
  assert.match(bad({ source: 'healthkit', workouts: [{ sourceRef: 'a', start: '2026-09-18T07:00:00Z', sport: 'yoga', durationSeconds: 100 }] }), /sport/);
  assert.match(bad({ source: 'healthkit', days: Array.from({ length: MAX_DAYS + 1 }, (_, i) => ({ day: `2020-01-${String((i % 28) + 1).padStart(2, '0')}` })) }), /Too many days/);
});

test('accepts a minimal payload from either store', () => {
  assert.equal(validateDevicePayload({ source: 'healthkit', days: [{ day: '2026-09-18', steps: 8000 }] }).ok, true);
  assert.equal(validateDevicePayload({ source: 'health_connect', workouts: [{ sourceRef: 'r1', start: '2026-09-18T07:00:00Z', sport: 'run', durationSeconds: 1800 }] }).ok, true);
});

// ---- mapping ----------------------------------------------------------------

test('a full day fans out to every derived table under the right provider', () => {
  const { batch, counts, skipped } = toNormalizedBatch(
    {
      source: 'healthkit',
      days: [{ day: '2026-09-18', steps: 9123.6, restingHr: 47.4, hrvMs: 61, sleep: { totalSeconds: 26100, deepSeconds: 5400, remSeconds: 6000 }, weightKg: 74.2, bodyFatPct: 14.1, vo2max: 52.3 }],
    },
    TODAY,
  );
  assert.deepEqual(counts, { days: 1, sleep: 1, hrv: 1, restingHr: 1, workouts: 0 });
  assert.deepEqual(skipped, []);
  const d = batch.dailySummaries![0];
  assert.equal(d.provider, 'apple');
  assert.equal(d.steps, 9124, 'steps are rounded to whole');
  assert.equal(d.restingHr, 47);
  assert.equal(d.weightKg, 74.2);
  assert.equal(d.vo2maxRunning, 52.3, 'device VO2max lands as the running estimate');
  assert.equal(batch.sleepRecords![0].totalSleepSeconds, 26100);
  assert.equal(batch.sleepRecords![0].lightSeconds, null);
  assert.equal(batch.hrvRecords![0].overnightAvgMs, 61);
  assert.equal(batch.restingHrRecords![0].restingHr, 47);
});

test('Health Connect data is tagged health_connect', () => {
  const { batch } = toNormalizedBatch({ source: 'health_connect', days: [{ day: '2026-09-18', hrvMs: 40 }] }, TODAY);
  assert.equal(batch.hrvRecords![0].provider, 'health_connect');
});

test('an implausible value drops ONLY that field, and says so', () => {
  const { batch, skipped } = toNormalizedBatch(
    { source: 'healthkit', days: [{ day: '2026-09-18', restingHr: 4, hrvMs: 55, weightKg: 9000 }] },
    TODAY,
  );
  assert.deepEqual(skipped, ['2026-09-18 restingHr', '2026-09-18 weightKg']);
  assert.equal(batch.restingHrRecords!.length, 0);
  assert.equal(batch.hrvRecords!.length, 1, 'the HRV survived');
  assert.equal(batch.dailySummaries!.length, 0, 'no empty daily row');
});

test('days beyond tomorrow and repeated days are dropped whole', () => {
  const { batch, skipped } = toNormalizedBatch(
    { source: 'healthkit', days: [{ day: '2026-09-25', steps: 1 }, { day: '2026-09-20', steps: 2 }, { day: '2026-09-18', steps: 3 }, { day: '2026-09-18', steps: 4 }] },
    TODAY,
  );
  assert.deepEqual(batch.dailySummaries!.map((d) => [d.day, d.steps]), [['2026-09-20', 2], ['2026-09-18', 3]]);
  assert.deepEqual(skipped, ['2026-09-25 (future day)', '2026-09-18 (duplicate day)']);
});

test('workouts become activities with a source-prefixed ref and derived pace', () => {
  const { batch, skipped } = toNormalizedBatch(
    {
      source: 'healthkit',
      workouts: [
        { sourceRef: 'ABC-123', start: '2026-09-18T07:00:00Z', sport: 'run', durationSeconds: 1800, distanceMeters: 6000, avgHr: 150, name: 'Morning Run' },
        { sourceRef: 'W-1', start: '2026-09-18T12:00:00Z', sport: 'walk', durationSeconds: 1200 },
        { sourceRef: 'S-1', start: '2026-09-18T18:00:00Z', sport: 'strength', durationSeconds: 30 }, // too short
      ],
    },
    TODAY,
  );
  assert.equal(batch.activities!.length, 2);
  const run = batch.activities![0];
  assert.equal(run.sourceRef, 'healthkit:ABC-123');
  assert.equal(run.provider, 'apple');
  assert.equal(run.avgPaceSecPerKm, 300);
  assert.equal(run.name, 'Morning Run');
  assert.equal(batch.activities![1].sport, 'cross_train', 'walks count as cross-training load, not runs');
  assert.deepEqual(skipped, ['workout S-1 durationSeconds']);
});

// ---- cross-source dedup rule -------------------------------------------------

const key = (sport: string, iso: string, dur: number | null) => ({ sport, startTime: new Date(iso), durationSeconds: dur });

test('same sport, same start (within 5 min), similar duration → same workout', () => {
  assert.equal(isSameWorkout(key('run', '2026-09-18T07:00:00Z', 1800), key('run', '2026-09-18T07:02:30Z', 1860)), true);
  assert.equal(isSameWorkout(key('run', '2026-09-18T07:00:00Z', 1800), key('bike', '2026-09-18T07:00:00Z', 1800)), false, 'different sport');
  assert.equal(isSameWorkout(key('run', '2026-09-18T07:00:00Z', 1800), key('run', '2026-09-18T07:06:00Z', 1800)), false, 'too far apart');
  assert.equal(isSameWorkout(key('run', '2026-09-18T07:00:00Z', 1800), key('run', '2026-09-18T07:00:00Z', 3600)), false, 'a different length session');
  assert.equal(isSameWorkout(key('run', '2026-09-18T07:00:00Z', null), key('run', '2026-09-18T07:00:00Z', 3600)), true, 'unknown duration trusts the start');
});

// ---- storage: idempotency, rate limit, both dedup directions ---------------

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '88888888-8888-4888-8888-888888888888';

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readdirSync(join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8')).join('\n--> statement-breakpoint\n');
  for (const s of sql.split('--> statement-breakpoint')) { const t = s.trim(); if (t) await client.exec(t); }
  await db.insert(athletes).values({ id: A, fullName: 'Device', email: 'device@e.com', timezone: 'UTC' });
  // A Strava run already on file — the watch will push the same session.
  await db.insert(activities).values({
    athleteId: A, provider: 'strava', sourceRef: 'strava:1', sport: 'run',
    startTime: new Date('2026-09-17T07:01:00Z'), durationSeconds: 1810, distanceMeters: 6050,
  });
});
after(async () => { await client.close(); });

const push = {
  source: 'healthkit' as const,
  days: [
    { day: '2026-09-18', steps: 9000, restingHr: 48, hrvMs: 60, sleep: { totalSeconds: 25000 }, weightKg: 74 },
    { day: '2026-09-17', steps: 12000, restingHr: 50 },
  ],
  workouts: [
    // Same as the Strava run above → must yield.
    { sourceRef: 'HK-1', start: '2026-09-17T07:00:00Z', sport: 'run' as const, durationSeconds: 1800, distanceMeters: 6000 },
    // Nothing else has this one → kept.
    { sourceRef: 'HK-2', start: '2026-09-18T17:00:00Z', sport: 'bike' as const, durationSeconds: 3600, distanceMeters: 30000 },
  ],
};

test('first push lands every table, dedups the Strava-owned run, marks the source connected', async () => {
  const r = await ingestDeviceHealth(db, A, push, TODAY);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.duplicate, false);
  assert.deepEqual(r.counts, { days: 2, sleep: 1, hrv: 1, restingHr: 2, workouts: 1, workoutsDeduped: 1 });
  assert.deepEqual(r.skipped, []);

  const acts = await db.select().from(activities).where(eq(activities.athleteId, A));
  assert.deepEqual(acts.map((a) => a.sourceRef).sort(), ['healthkit:HK-2', 'strava:1']);
  assert.equal((await db.select().from(sleepRecords).where(eq(sleepRecords.athleteId, A))).length, 1);
  assert.equal((await db.select().from(hrvRecords).where(eq(hrvRecords.athleteId, A))).length, 1);
  assert.equal((await db.select().from(restingHrRecords).where(eq(restingHrRecords.athleteId, A))).length, 2);
  const daily = await db.select().from(dailySummaries).where(eq(dailySummaries.athleteId, A));
  assert.equal(daily.find((d) => d.day === '2026-09-18')?.weightKg, 74);
  const [conn] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.athleteId, A));
  assert.equal(conn.provider, 'apple');
  assert.equal(conn.status, 'active');
});

test('the identical push again is a no-op duplicate', async () => {
  const r = await ingestDeviceHealth(db, A, push, TODAY);
  assert.equal(r.ok && r.duplicate, true);
  assert.equal((await db.select().from(rawEvents).where(eq(rawEvents.athleteId, A))).length, 1);
});

test('a later push with updated steps refreshes the day without duplicating rows', async () => {
  const r = await ingestDeviceHealth(db, A, { source: 'healthkit', days: [{ day: '2026-09-18', steps: 11000, restingHr: 47 }] }, TODAY);
  assert.equal(r.ok && !r.duplicate, true);
  const daily = await db.select().from(dailySummaries).where(eq(dailySummaries.athleteId, A));
  assert.equal(daily.length, 2);
  assert.equal(daily.find((d) => d.day === '2026-09-18')?.steps, 11000, 'steps grew through the day');
  assert.equal(daily.find((d) => d.day === '2026-09-18')?.weightKg, 74, 'a push without weight did not wipe it');
  assert.equal((await db.select().from(restingHrRecords).where(eq(restingHrRecords.athleteId, A))).length, 2, 'one RHR row per day');
});

test('a malformed body is a 400, not a crash', async () => {
  const r = await ingestDeviceHealth(db, A, { source: 'healthkit', days: [{ day: 'nope' }] }, TODAY);
  assert.deepEqual(r.ok ? null : r.status, 400);
});

test('the per-athlete rate limit counts real pushes in the window', async () => {
  const r = await ingestDeviceHealth(db, A, { source: 'healthkit', days: [{ day: '2026-09-16', steps: 1 }] }, TODAY, { maxPerWindow: 2, windowMs: 3600_000 });
  assert.deepEqual(r.ok ? null : r.status, 429);
});

test('when Strava lands a session the device already pushed, the device copy yields', async () => {
  // The HK-2 ride is on file from the device. Now the same ride arrives via the
  // generic persist path tagged strava.
  await persistNormalizedBatch(db, A, null, {
    activities: [{ sourceRef: 'strava:2', sport: 'bike', startTime: new Date('2026-09-18T17:01:00Z'), durationSeconds: 3650, distanceMeters: 30100, trainingLoad: null }],
  }, 'strava');
  const acts = await db.select().from(activities).where(eq(activities.athleteId, A));
  assert.deepEqual(acts.map((a) => a.sourceRef).sort(), ['strava:1', 'strava:2']);
});

test('supersede leaves unrelated device workouts alone', async () => {
  await db.insert(activities).values({ athleteId: A, provider: 'apple', sourceRef: 'healthkit:HK-3', sport: 'swim', startTime: new Date('2026-09-18T06:00:00Z'), durationSeconds: 1800 });
  const n = await supersedeDeviceWorkouts(db, A, [{ sport: 'run', startTime: new Date('2026-09-18T06:00:00Z'), durationSeconds: 1800 }]);
  assert.equal(n, 0);
  assert.equal((await db.select().from(activities).where(eq(activities.sourceRef, 'healthkit:HK-3'))).length, 1);
});
