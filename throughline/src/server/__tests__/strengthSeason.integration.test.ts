/**
 * Supporting strength scheduler — lays a weekly strength cadence over the plan,
 * discipline-scoped so it coexists with endurance, idempotent on re-run.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, plans, plannedSessions } from '@/db/schema';
import { setupSupportingStrength, getSupportingStrengthDays } from '../strengthSeason';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '44444444-4444-4444-4444-444444444444';
const TODAY = '2026-08-17'; // a Monday

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
  await db.insert(athletes).values({ id: A, fullName: 'Strength Athlete', email: 's@example.com', timezone: 'UTC' });
  // A published RUN plan for the current week, to anchor the strength horizon.
  const [runPlan] = await db
    .insert(plans)
    .values({ athleteId: A, status: 'published', discipline: 'run', weekStart: '2026-08-17', weekEnd: '2026-08-23' })
    .returning({ id: plans.id });
  await db.insert(plannedSessions).values({
    planId: runPlan.id, athleteId: A, day: '2026-08-18', discipline: 'run', sessionType: 'easy', targetDistanceMeters: 8000,
  });
});

after(async () => {
  await client.close();
});

test('2×/week lays strength sessions that coexist with the run plan', async () => {
  const res = await setupSupportingStrength(db, A, TODAY, { daysPerWeek: 2 });
  assert.equal(res.daysPerWeek, 2);
  assert.ok(res.sessions > 0, 'strength sessions were created');

  // Strength sessions exist, tagged strength, with a duration.
  const strengthSessions = await db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.athleteId, A), eq(plannedSessions.discipline, 'strength')));
  assert.ok(strengthSessions.length >= 2);
  assert.ok(strengthSessions.every((s) => (s.targetDurationSeconds ?? 0) > 0), 'each has a duration');

  // The run plan + its session are untouched (discipline-scoped).
  const runSessions = await db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.athleteId, A), eq(plannedSessions.discipline, 'run')));
  assert.equal(runSessions.length, 1, 'run session survived');

  assert.equal(await getSupportingStrengthDays(db, A), 2);
});

test('re-running replaces strength only, and 0 removes it', async () => {
  await setupSupportingStrength(db, A, TODAY, { daysPerWeek: 3 });
  assert.equal(await getSupportingStrengthDays(db, A), 3);

  const removed = await setupSupportingStrength(db, A, TODAY, { daysPerWeek: 0 });
  assert.equal(removed.sessions, 0);
  const strengthPlans = await db
    .select()
    .from(plans)
    .where(and(eq(plans.athleteId, A), eq(plans.discipline, 'strength')));
  assert.equal(strengthPlans.length, 0, 'strength plans removed');
  // Run plan still there.
  const runPlans = await db.select().from(plans).where(and(eq(plans.athleteId, A), eq(plans.discipline, 'run')));
  assert.equal(runPlans.length, 1);
});
