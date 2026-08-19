/**
 * Coordinated run + bike — an athlete can hold a RUN goal and a BIKE goal at the
 * same time. Each single-sport setup only replaces races/plans of its OWN
 * discipline (races.discipline), so setting up one never wipes the other, and
 * each read-model resolves its own discipline's race (never the sibling's).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, races, plans } from '@/db/schema';
import { setupSeason } from '../season';
import { setupBikeSeason } from '../bikeSeason';
import { setAthletePowerConfig } from '@/db/powerConfig';
import { getBikeGoalTracker } from '../bikeGoalTracker';
// NB: getRacePlan (the run tracker) can't be imported here — it pulls in
// server/anchor.ts, which is `server-only`. We instead assert the run goal is
// correctly discipline-tagged, which is exactly what getRacePlan filters on.

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '77777777-7777-4777-7777-777777777777';
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
  await db.insert(athletes).values({ id: A, fullName: 'Dual Athlete', email: 'dual@example.com', timezone: 'UTC' });
  // A cycling anchor (FTP) so the bike setup can build power zones.
  await setAthletePowerConfig(db, A, { ftpWatts: 245, weightKg: 78 });
});

after(async () => {
  await client.close();
});

test('a bike goal set up first survives a later run-goal setup', async () => {
  // 1) Bike goal first (a hilly fondo, built off the FTP anchor).
  await setupBikeSeason(db, A, {
    startDay: TODAY,
    goalRace: { name: 'Autumn Fondo', date: '2027-05-01', distanceLabel: 'Fondo', distanceMeters: 120000 },
    weeklyHours: 6,
    publish: true,
  });

  // 2) Run goal second — this must NOT wipe the bike goal/plan.
  await setupSeason(db, A, {
    startDay: TODAY,
    goalRace: { name: 'Marathon', date: '2027-04-01', distanceLabel: 'Marathon', distanceMeters: 42195, goalType: 'time', targetTimeSeconds: 3 * 3600 + 30 * 60 },
    fitness: { race: { distanceMeters: 21097.5, timeSeconds: 95 * 60 } },
    startVolumeMiles: 30,
    peakVolumeMiles: 50,
    publish: true,
  });

  // Both goals coexist, each tagged with its own discipline.
  const raceRows = await db.select().from(races).where(eq(races.athleteId, A));
  const bikeGoal = raceRows.find((r) => r.discipline === 'bike' && r.priority === 'goal');
  const runGoal = raceRows.find((r) => r.discipline === 'run' && r.priority === 'goal');
  assert.ok(bikeGoal, 'bike goal survived the run setup');
  assert.ok(runGoal, 'run goal was created');
  assert.equal(bikeGoal!.name, 'Autumn Fondo');
  assert.equal(runGoal!.name, 'Marathon');

  // Both plans coexist.
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.ok(planRows.some((p) => p.discipline === 'bike'), 'bike plan survived');
  assert.ok(planRows.some((p) => p.discipline === 'run'), 'run plan was created');

  // The bike tracker resolves its OWN race even though BOTH goals carry
  // priority='goal' — this is the real cross-contamination guard (it filters on
  // discipline='bike'). getRacePlan filters symmetrically on discipline='run'.
  const bikeTracker = await getBikeGoalTracker(db, A, TODAY);
  assert.ok(bikeTracker, 'bike tracker resolves');
  assert.equal(bikeTracker!.goalName, 'Autumn Fondo', 'bike tracker points at the BIKE race, not the marathon');

  // The run tracker's selector: raceList.find(priority==='goal' && discipline==='run').
  const runResolved = raceRows.find((r) => r.priority === 'goal' && r.discipline === 'run');
  assert.equal(runResolved!.name, 'Marathon', 'run tracker would resolve the RUN race, not the fondo');
});

test('re-running the bike setup does not wipe the coexisting run goal', async () => {
  await setupBikeSeason(db, A, {
    startDay: TODAY,
    goalRace: { name: 'Spring Fondo', date: '2027-06-01', distanceLabel: 'Fondo', distanceMeters: 100000 },
    weeklyHours: 7,
    publish: true,
  });

  const raceRows = await db.select().from(races).where(and(eq(races.athleteId, A), eq(races.priority, 'goal')));
  const runGoal = raceRows.find((r) => r.discipline === 'run');
  const bikeGoal = raceRows.find((r) => r.discipline === 'bike');
  assert.ok(runGoal, 'run goal still present after re-running bike setup');
  assert.equal(runGoal!.name, 'Marathon');
  assert.equal(bikeGoal!.name, 'Spring Fondo', 'bike goal was replaced (idempotent within its discipline)');

  // Exactly one goal race per discipline — no duplicates piled up.
  assert.equal(raceRows.filter((r) => r.discipline === 'bike').length, 1, 'one bike goal, not duplicated');
  assert.equal(raceRows.filter((r) => r.discipline === 'run').length, 1, 'one run goal, untouched');
});
