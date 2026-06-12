/**
 * Athlete goal setup — real Postgres via PGlite. Verifies each goal path builds
 * a plan and that "use existing fitness" reuses the anchor.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, plans, races } from '@/db/schema';
import { setupAthleteGoal } from '../athleteGoal';
import { getAthleteVdot } from '@/db/paceConfig';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '66666666-6666-4666-8666-666666666666';
const TODAY = '2026-06-09';

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
  await db.insert(athletes).values({ id: A, fullName: 'Goal Tester', email: 'goal@x.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

test('athlete goal publishes immediately and the plan starts THIS week (base today)', async () => {
  await setupAthleteGoal(db, A, TODAY, {
    kind: 'time',
    distanceLabel: '5K',
    targetTimeSeconds: 22 * 60,
    date: '2026-08-08',
    fitness: { kind: 'race', distanceLabel: '5K', timeSeconds: 1380 },
    currentWeeklyMiles: 10,
  });
  const rows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((p) => p.status === 'published'), 'self-service weeks are published, not drafts');
  const current = rows.find((p) => p.weekStart <= TODAY && TODAY <= p.weekEnd);
  assert.ok(current, `a plan week contains today (${TODAY}) — no dead gap before the build`);
  assert.equal(current!.phase, 'base', 'the athlete starts by building base');
});

test('race-for-time goal builds a plan and sets the anchor from the recent race', async () => {
  const { weeks } = await setupAthleteGoal(db, A, TODAY, {
    kind: 'time',
    distanceLabel: 'Half',
    targetTimeSeconds: 95 * 60,
    date: '2026-09-13',
    fitness: { kind: 'race', distanceLabel: '5K', timeSeconds: 22 * 60 },
    currentWeeklyMiles: 22,
  });
  assert.ok(weeks > 0, 'generated weeks');
  const [goal] = await db.select().from(races).where(eq(races.athleteId, A));
  assert.equal(goal.priority, 'goal');
  assert.equal(goal.goalType, 'time');
  const vdot = await getAthleteVdot(db, A);
  assert.ok(vdot != null && vdot > 40 && vdot < 60, `anchor vdot ${vdot}`);
});

test('"use existing fitness" keeps the prior anchor (does not require a race)', async () => {
  const before = await getAthleteVdot(db, A);
  await setupAthleteGoal(db, A, TODAY, {
    kind: 'finish',
    distanceLabel: 'Marathon',
    date: '2026-12-06',
    fitness: { kind: 'existing' },
    currentWeeklyMiles: 25,
  });
  const after = await getAthleteVdot(db, A);
  assert.ok(after != null && Math.abs(after - (before ?? 0)) < 0.6, 'anchor unchanged');
  const rows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.ok(rows.length > 0, 'plan rebuilt');
});

test('build-fitness goal works with no race date', async () => {
  const { weeks } = await setupAthleteGoal(db, A, TODAY, {
    kind: 'fitness',
    fitness: { kind: 'existing' },
    currentWeeklyMiles: 18,
  });
  assert.ok(weeks > 0);
  const [goal] = await db.select().from(races).where(eq(races.athleteId, A));
  assert.equal(goal.name, 'Build fitness');
});

test('rejects "use existing fitness" when there is no anchor yet', async () => {
  const B = '66666666-6666-4666-8666-666666666667';
  await db.insert(athletes).values({ id: B, fullName: 'No Anchor', email: 'noanchor@x.com', timezone: 'UTC' });
  await assert.rejects(
    setupAthleteGoal(db, B, TODAY, {
      kind: 'finish',
      distanceLabel: '5K',
      date: '2026-09-01',
      fitness: { kind: 'existing' },
      currentWeeklyMiles: 15,
    }),
    /fitness starting point|recent race/i,
  );
});
