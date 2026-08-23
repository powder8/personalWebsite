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
import { athletes, races, plans } from '@/db/schema';
import { setAthletePaceConfig } from '@/db/paceConfig';
import { setAthletePowerConfig } from '@/db/powerConfig';
import { setupTriSeason } from '../triSeason';
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
