/**
 * Per-sport fitness progress over real activity rows, and a guard on the
 * scoredRunEfforts extraction that suggestAnchorCandidates now builds on.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '@/db/schema';
import { athletes, activities } from '@/db/schema';
import { getFitnessProgress } from '../fitnessProgress';
import { scoredRunEfforts } from '../runEfforts';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '77777777-7777-4777-8777-777777777777';
const TODAY = '2026-09-07';

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

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
  await db.insert(athletes).values({ id: A, fullName: 'Trend Athlete', email: 'trend@example.com', timezone: 'UTC' });

  await db.insert(activities).values([
    // RUN: two 5K races — slower in spring, faster this month (workoutType 1 =
    // race, so both are trusted efforts and anchor cleanly).
    { athleteId: A, sport: 'run', startTime: at('2026-04-20'), distanceMeters: 5000, durationSeconds: 25 * 60, workoutType: 1 },
    { athleteId: A, sport: 'run', startTime: at('2026-09-02'), distanceMeters: 5000, durationSeconds: 22 * 60, workoutType: 1 },
    // BIKE: same ride, lower heart rate lately → more metres per beat.
    { athleteId: A, sport: 'bike', startTime: at('2026-04-21'), distanceMeters: 30000, durationSeconds: 3600, avgHr: 150 },
    { athleteId: A, sport: 'bike', startTime: at('2026-09-03'), distanceMeters: 30000, durationSeconds: 3600, avgHr: 140 },
    // SWIM: 1500 m, faster lately.
    { athleteId: A, sport: 'swim', startTime: at('2026-04-22'), distanceMeters: 1500, durationSeconds: 1800 },
    { athleteId: A, sport: 'swim', startTime: at('2026-09-04'), distanceMeters: 1500, durationSeconds: 1700 },
    // Noise that must NOT become a reading: a 2 km spin and a 100 m warm-up swim.
    { athleteId: A, sport: 'bike', startTime: at('2026-09-05'), distanceMeters: 2000, durationSeconds: 600, avgHr: 120 },
    { athleteId: A, sport: 'swim', startTime: at('2026-09-05'), distanceMeters: 100, durationSeconds: 120 },
  ]);
});

after(async () => {
  await client.close();
});

test('every trained sport gets its own progress track', async () => {
  const { sports } = await getFitnessProgress(db, A, TODAY);
  assert.deepEqual(sports.map((s) => s.sport).sort(), ['bike', 'run', 'swim']);
});

test('running trends on VDOT and reports it as VO2max', async () => {
  const run = (await getFitnessProgress(db, A, TODAY)).sports.find((s) => s.sport === 'run')!;
  assert.equal(run.metric, 'vdot');
  assert.ok(run.baseline != null && run.current != null, 'two periods → a real trend');
  assert.ok(run.current! > run.baseline!, 'the faster 5K raised fitness');
  assert.equal(run.direction, 'up');
  assert.ok(run.vo2max != null && run.vo2max > 30, 'VDOT doubles as the VO2max read');
});

test('cycling trends on metres per heartbeat (no power data to derive FTP from)', async () => {
  const bike = (await getFitnessProgress(db, A, TODAY)).sports.find((s) => s.sport === 'bike')!;
  assert.equal(bike.metric, 'efficiency');
  assert.equal(bike.samples, 2, 'the 2 km spin is too short to count');
  // 30000/(140*60)=3.571 now vs 30000/(150*60)=3.333 before.
  assert.ok(Math.abs(bike.current! - 3.571) < 0.01);
  assert.equal(bike.direction, 'up', 'same ride at a lower HR = fitter');
  assert.equal(bike.vo2max, null, 'no honest VO2max without power');
});

test('swimming trends on pace per 100 m, where FASTER is better', async () => {
  const swim = (await getFitnessProgress(db, A, TODAY)).sports.find((s) => s.sport === 'swim')!;
  assert.equal(swim.metric, 'swim_pace');
  assert.equal(swim.samples, 2, 'the 100 m warm-up is excluded');
  assert.ok(Math.abs(swim.current! - 1700 / 15) < 0.01, 'sec per 100 m');
  assert.ok(swim.deltaPct! > 0 && swim.direction === 'up', 'a falling pace is improvement');
});

test('a sport with no qualifying work is left out, not shown as zero', async () => {
  const B = '77777777-7777-4777-8777-7777777777bb';
  await db.insert(athletes).values({ id: B, fullName: 'Runner Only', email: 'runonly@example.com', timezone: 'UTC' });
  await db.insert(activities).values({ athleteId: B, sport: 'run', startTime: at('2026-09-02'), distanceMeters: 5000, durationSeconds: 22 * 60, workoutType: 1 });
  const { sports } = await getFitnessProgress(db, B, TODAY);
  assert.deepEqual(sports.map((s) => s.sport), ['run']);
  assert.equal(sports[0].baseline, null, 'one period → no trend claimed');
  assert.equal(sports[0].direction, 'unknown');
});

test('run efforts are scored per activity, nothing de-duped away', async () => {
  // The anchor picks the best of these; the trend charts them all. Guards the
  // extraction of the scorer out of anchor.ts.
  const scored = await scoredRunEfforts(db, A, { days: 365 });
  assert.equal(scored.length, 2, 'both races scored');
  const best = [...scored].sort((a, b) => b.vdot - a.vdot)[0];
  assert.equal(best.day, '2026-09-02', 'the faster race is the strongest effort');
  assert.ok(best.vdot > 40);
  assert.ok(scored.every((s) => s.isRace && s.trusted), 'workout_type 1 = trusted race effort');
});
