/**
 * Triathlon season setup integration test — real Postgres via PGlite.
 * Covers the G7 goal-time wiring: setupTriSeason with a target finish persists
 * the timed goal and returns the per-leg decomposition + binding-leg verdict.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, races, plans } from '@/db/schema';
import { setupTriSeason } from '../triSeason';
import { getTriGoalTracker } from '../triGoalTracker';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '55555555-5555-4555-8555-555555555555';

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
  // A triathlete carrying all three anchors (VDOT / FTP / CSS) + body mass.
  await db.insert(athletes).values({
    id: A,
    fullName: 'Tri Test',
    email: 'tri@example.com',
    timezone: 'UTC',
    paceConfig: { vdot: 48 },
    powerConfig: { ftpWatts: 240, weightKg: 74 },
    swimConfig: { cssMetersPerSec: 1.3 },
  });
});

after(async () => {
  await client.close();
});

const GOAL = {
  name: 'Oceanside 70.3',
  date: '2027-06-13',
  distance: '70.3' as const,
  distanceMeters: 70300,
};

test('setupTriSeason with a target finish persists the timed goal + returns the verdict', async () => {
  const res = await setupTriSeason(db, A, {
    startDay: '2026-08-17', // a Monday
    goalRace: GOAL,
    weeklyHours: 9,
    limiter: 'swim',
    goalFinishSeconds: 5 * 3600 + 15 * 60, // sub-5:15
    publish: true,
  });

  // The goal-time layer came back.
  assert.ok(res.goalTime, 'decomposition returned');
  assert.equal(res.goalTime!.strategy, 'strength_relative');
  assert.ok(res.feasibility, 'feasibility returned (all three anchors present)');
  assert.ok(['ahead', 'on_track', 'stretch', 'unrealistic'].includes(res.feasibility!.verdict));
  assert.ok(['swim', 'bike', 'run'].includes(res.feasibility!.bindingLeg));
  assert.ok(res.feasibility!.realisticFinishSeconds > 0);

  // The target is persisted on the goal race as a timed goal.
  const [race] = await db.select().from(races).where(eq(races.athleteId, A));
  assert.equal(race.goalType, 'time');
  assert.equal(race.targetTimeSeconds, 5 * 3600 + 15 * 60);

  // One published plan per sport.
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  const disciplines = new Set(planRows.map((p) => p.discipline));
  assert.equal(disciplines.size, 3);
  assert.ok(planRows.every((p) => p.status === 'published'));

  // The portal tracker recomputes the same verdict from the persisted goal.
  const tracker = await getTriGoalTracker(db, A, '2026-08-17');
  assert.ok(tracker, 'tri goal tracker present for a timed tri goal');
  assert.equal(tracker!.targetFinishSeconds, 5 * 3600 + 15 * 60);
  assert.equal(tracker!.distance, '70.3');
  assert.equal(tracker!.feasibility.verdict, res.feasibility!.verdict);
  assert.equal(tracker!.feasibility.bindingLeg, res.feasibility!.bindingLeg);
  assert.ok(tracker!.daysAway > 0);
});

test('setupTriSeason WITHOUT a target finish → untimed goal, no feasibility (unchanged path)', async () => {
  const res = await setupTriSeason(db, A, {
    startDay: '2026-08-17',
    goalRace: GOAL,
    weeklyHours: 9,
    limiter: 'swim',
  });
  assert.equal(res.goalTime, undefined);
  assert.equal(res.feasibility, undefined);
  const [race] = await db.select().from(races).where(eq(races.athleteId, A));
  assert.equal(race.goalType, 'none');
  assert.equal(race.targetTimeSeconds, null);
  // No timed goal → no tri tracker (portal falls back to the single-sport one).
  assert.equal(await getTriGoalTracker(db, A, '2026-08-17'), null);
});
