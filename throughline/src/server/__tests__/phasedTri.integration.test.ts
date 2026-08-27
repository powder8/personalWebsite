/**
 * Phased triathlon setup — bike + run now, swim deferred. Proves an athlete with
 * only run + bike anchors can create a real TRI goal (not a run goal): a tri
 * distance race, bike + run plans, no swim plan, and a tri tracker that marks the
 * swim leg "not started".
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, races, plans, plannedSessions } from '@/db/schema';
import { setAthleteFtp } from '../bikeAdjust';
import { setAthletePaceConfig, getAthleteVdot } from '@/db/paceConfig';
import { setAthletePowerConfig, getAthleteFtp } from '@/db/powerConfig';
import type { AthletePaceConfig, AthletePowerConfig } from '@/engine/plan';
import { setupTriSeason } from '../triSeason';
import { setupAthleteTriGoal } from '../athleteTriGoal';
import { getTriGoalTracker } from '../triGoalTracker';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '33333333-3333-4333-3333-333333333333';
const TODAY = '2026-08-17';

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
  await db.insert(athletes).values({ id: A, fullName: 'Phased Triathlete', email: 'tri@example.com', timezone: 'UTC' });
  // Run + bike anchors only — NO swim.
  await setAthletePaceConfig(db, A, { race: { distanceMeters: 10000, timeSeconds: 42 * 60 } });
  await setAthletePowerConfig(db, A, { ftpWatts: 240, weightKg: 75 });
});

after(async () => {
  await client.close();
});

test('a tri can be set up with swim deferred: tri race + bike/run plans, no swim', async () => {
  const res = await setupTriSeason(db, A, {
    startDay: TODAY,
    goalRace: { name: 'Maryland Triathlon', date: '2027-06-26', distance: '70.3' },
    weeklyHours: 8,
    limiter: 'run',
    goalFinishSeconds: 5 * 3600 + 30 * 60,
    publish: true,
  });

  // Only the trained sports got a budget.
  assert.ok(res.budgets.bike && res.budgets.run, 'bike + run budgeted');
  assert.equal(res.budgets.swim, undefined, 'no swim budget');

  // A real tri goal race (tri distance), so the tri tracker recognizes it.
  const [race] = await db.select().from(races).where(and(eq(races.athleteId, A), eq(races.priority, 'goal')));
  assert.equal(race.distanceLabel, '70.3');
  assert.equal(race.goalType, 'time');

  // Bike + run plans exist; NO swim plan.
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  const disc = new Set(planRows.map((p) => p.discipline));
  assert.ok(disc.has('bike') && disc.has('run'), 'bike + run plans');
  assert.ok(!disc.has('swim'), 'no swim plan');

  // The tri tracker shows, with swim deferred.
  const tracker = await getTriGoalTracker(db, A, TODAY);
  assert.ok(tracker, 'tri tracker resolves (not a run goal)');
  assert.equal(tracker!.swimDeferred, true);
  assert.equal(tracker!.feasibility.legs.swim.deferred, true);
  assert.notEqual(tracker!.feasibility.bindingLeg, 'swim', 'swim never binds while deferred');
});

test('the athlete-facing setup keeps the race NAME (not the distance label)', async () => {
  await setupAthleteTriGoal(db, A, TODAY, {
    distance: 'olympic',
    name: 'Maryland Triathlon',
    date: '2027-06-26',
    targetFinishSeconds: 2 * 3600 + 45 * 60,
    weeklyHours: 8,
    limiter: 'run',
    run: { race: { distanceMeters: 10000, timeSeconds: 42 * 60 } },
    bike: { ftpWatts: 240, weightKg: 75 },
    // no swim → phased
  });
  const [race] = await db.select().from(races).where(and(eq(races.athleteId, A), eq(races.priority, 'goal')));
  assert.equal(race.name, 'Maryland Triathlon', 'the athlete-named race survives setup');
  assert.equal(race.distanceLabel, 'olympic', 'the tri distance still drives the tracker');
  const tracker = await getTriGoalTracker(db, A, TODAY);
  assert.equal(tracker!.goalName, 'Maryland Triathlon');
});

test('no 10K time and no FTP → conservative AUTO anchors, plan still builds', async () => {
  const N = '33333333-3333-4333-3333-333333333999';
  await db.insert(athletes).values({ id: N, fullName: 'No Numbers', email: 'nonums@example.com', timezone: 'UTC' });

  const res = await setupAthleteTriGoal(db, N, TODAY, {
    distance: 'olympic',
    name: 'First Tri',
    date: '2027-06-26',
    targetFinishSeconds: 3 * 3600,
    weeklyHours: 6,
    limiter: 'swim',
    run: {}, // no race, no vdot
    bike: { weightKg: 80 }, // weight but no FTP
    // no swim
  });
  assert.ok(res.budgets.bike && res.budgets.run, 'a plan built from estimates');

  // Both anchors are seeded and tagged 'auto' so real performance refines them.
  const vdot = await getAthleteVdot(db, N);
  assert.equal(vdot, 40, 'conservative starter VDOT');
  const ftp = await getAthleteFtp(db, N);
  assert.equal(ftp, Math.round(2.2 * 80), 'FTP estimated from body mass (2.2 W/kg)');

  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, N));
  assert.equal((athlete.paceConfig as AthletePaceConfig).anchorSource, 'auto');
  assert.equal((athlete.powerConfig as AthletePowerConfig).anchorSource, 'auto');

  // The tri tracker resolves off the estimates (swim deferred).
  const tracker = await getTriGoalTracker(db, N, TODAY);
  assert.ok(tracker, 'tracker resolves from estimated fitness');
  assert.equal(tracker!.swimDeferred, true);
});

test('a real run race + FTP are tagged MANUAL (not overwritten by estimates)', async () => {
  await setupAthleteTriGoal(db, A, TODAY, {
    distance: 'sprint',
    date: '2027-08-01',
    weeklyHours: 7,
    limiter: 'run',
    run: { race: { distanceMeters: 10000, timeSeconds: 42 * 60 } },
    bike: { ftpWatts: 250, weightKg: 75 },
  });
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, A));
  assert.equal((athlete.paceConfig as AthletePaceConfig).anchorSource, 'manual');
  assert.equal((athlete.powerConfig as AthletePowerConfig).anchorSource, 'manual');
  assert.equal(await getAthleteFtp(db, A), 250);
});

test('raising FTP re-tunes future rides — the plan tracks your numbers', async () => {
  const F = '33333333-3333-4333-3333-333333333f00';
  await db.insert(athletes).values({ id: F, fullName: 'Getting Fitter', email: 'fitter@example.com', timezone: 'UTC' });
  await setupAthleteTriGoal(db, F, TODAY, {
    distance: 'olympic',
    date: '2027-06-26',
    weeklyHours: 8,
    limiter: 'swim',
    run: { race: { distanceMeters: 10000, timeSeconds: 44 * 60 } },
    bike: { ftpWatts: 200, weightKg: 75 },
  });

  const bikeBandBefore = async () => {
    const rows = await db.select().from(plannedSessions).where(and(eq(plannedSessions.athleteId, F), eq(plannedSessions.discipline, 'bike')));
    return rows.find((r) => r.zone && r.targetPowerHighWatts != null)?.targetPowerHighWatts ?? null;
  };
  const before = await bikeBandBefore();
  assert.ok(before && before > 0, 'a future ride has a baked watt band');

  const res = await setAthleteFtp(db, F, 260, { today: TODAY });
  assert.equal(res.ftpWatts, 260);
  assert.ok(res.updatedSessions > 0, 'future rides were re-tuned');

  const after = await bikeBandBefore();
  assert.ok(after! > before!, `watt bands scaled up with FTP (${before} → ${after})`);
});

test('a blank name falls back to the distance name', async () => {
  await setupAthleteTriGoal(db, A, TODAY, {
    distance: 'sprint',
    date: '2027-07-10',
    weeklyHours: 6,
    limiter: 'run',
    run: { race: { distanceMeters: 5000, timeSeconds: 20 * 60 } },
    bike: { ftpWatts: 230 },
  });
  const [race] = await db.select().from(races).where(and(eq(races.athleteId, A), eq(races.priority, 'goal')));
  assert.equal(race.name, 'Sprint Triathlon');
});
