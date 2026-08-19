/**
 * Coordinated run + bike resizer — one weekly-hours budget, split by demand,
 * rebuilds BOTH plans to fit (instead of two full-time plans overlapping).
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
import { setupSeason } from '../season';
import { setupBikeSeason } from '../bikeSeason';
import { setAthletePowerConfig } from '@/db/powerConfig';
import { resplitDualSeason } from '../dualSeason';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '66666666-6666-4666-6666-666666666666';
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
  await db.insert(athletes).values({ id: A, fullName: 'Coordinated Athlete', email: 'coord@example.com', timezone: 'UTC' });
  await setAthletePowerConfig(db, A, { ftpWatts: 240, weightKg: 75 });

  // Two independent goals, set up on their own (each discipline-scoped).
  await setupBikeSeason(db, A, {
    startDay: TODAY,
    goalRace: { name: 'Gran Fondo', date: '2027-05-01', distanceLabel: 'Fondo', distanceMeters: 110000 },
    weeklyHours: 8,
    publish: true,
  });
  await setupSeason(db, A, {
    startDay: TODAY,
    goalRace: { name: 'Marathon', date: '2027-04-15', distanceLabel: 'Marathon', distanceMeters: 42195, goalType: 'time', targetTimeSeconds: 3 * 3600 + 20 * 60 },
    fitness: { race: { distanceMeters: 21097.5, timeSeconds: 92 * 60 } },
    startVolumeMiles: 35,
    peakVolumeMiles: 55,
    publish: true,
  });
});

after(async () => {
  await client.close();
});

test('a 10 h budget is split by demand and rebuilds both plans to fit', async () => {
  const res = await resplitDualSeason(db, A, TODAY, { weeklyHours: 10, publish: true });

  assert.deepEqual(res.disciplines.sort(), ['bike', 'run']);
  // Demand: the bike absorbs more marginal hours than the run.
  assert.ok(res.hours.bike! > res.hours.run!, `bike ${res.hours.bike} > run ${res.hours.run}`);
  // The split conserves the budget (within rounding).
  assert.ok(Math.abs(res.hours.bike! + res.hours.run! - 10) < 0.2, `Σ ${res.hours.bike! + res.hours.run!} ≈ 10`);

  // The shared budget is persisted on the athlete (so the portal control shows it).
  const [ath] = await db.select().from(athletes).where(eq(athletes.id, A));
  assert.equal(ath.weeklyHoursBudget, 10, 'weekly-hours budget persisted');

  // Both goal races survive the rebuild.
  const raceRows = await db.select().from(races).where(eq(races.athleteId, A));
  assert.ok(raceRows.some((r) => r.discipline === 'run' && r.name === 'Marathon'), 'run goal preserved');
  assert.ok(raceRows.some((r) => r.discipline === 'bike' && r.name === 'Gran Fondo'), 'bike goal preserved');

  // Both plans exist, each in its own discipline.
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.ok(planRows.some((p) => p.discipline === 'run'), 'a run plan exists');
  assert.ok(planRows.some((p) => p.discipline === 'bike'), 'a bike plan exists');

  // The bike plan was rebuilt at its ALLOCATED hours (not the original 8 h).
  const bikePlan = planRows
    .filter((p) => p.discipline === 'bike')
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0];
  const meta = bikePlan.generatedFrom as { weeklyHours?: number } | null;
  assert.ok(meta?.weeklyHours != null, 'bike plan carries its hours');
  assert.ok(Math.abs(meta!.weeklyHours! - res.hours.bike!) < 0.2, `bike plan hours ${meta!.weeklyHours} ≈ allocated ${res.hours.bike}`);
});

test('naming the run as the A-goal shifts hours toward the run', async () => {
  const neutral = await resplitDualSeason(db, A, TODAY, { weeklyHours: 10, publish: true });
  const runFirst = await resplitDualSeason(db, A, TODAY, { weeklyHours: 10, priority: 'run', publish: true });
  assert.ok(runFirst.hours.run! > neutral.hours.run!, `A-goal run ${runFirst.hours.run} > neutral ${neutral.hours.run}`);
});
