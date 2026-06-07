/**
 * Season setup integration test — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, races, plans } from '@/db/schema';
import { setupSeason, getSeasonPlan, getUpcomingWeeks } from '../season';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '44444444-4444-4444-8444-444444444444';

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readFileSync(join(process.cwd(), 'drizzle', '0000_init.sql'), 'utf8');
  for (const s of sql.split('--> statement-breakpoint')) {
    const t = s.trim();
    if (t) await client.exec(t);
  }
  await db.insert(athletes).values({ id: A, fullName: 'Season Test', email: 'season@example.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

const INPUT = {
  startDay: '2026-01-05',
  goalRace: {
    name: 'CIM Marathon',
    date: '2026-06-07',
    distanceLabel: 'Marathon',
    distanceMeters: 42195,
    priority: 'goal' as const,
    goalType: 'time' as const,
    targetTimeSeconds: 2 * 3600 + 38 * 60,
  },
  keyRaces: [
    { name: 'Spring Half', date: '2026-04-26', distanceLabel: 'Half', priority: 'tune_up' as const },
  ],
  fitness: { race: { distanceMeters: 21097.5, timeSeconds: 73 * 60 } },
  startVolumeMiles: 50,
  peakVolumeMiles: 72,
};

test('setupSeason generates races + a race-aware plan', async () => {
  const res = await setupSeason(db, A, INPUT);
  assert.ok(res.weeks > 12);
  assert.equal(res.raceCount, 2);

  const raceRows = await db.select().from(races).where(eq(races.athleteId, A));
  assert.equal(raceRows.length, 2);
  assert.ok(raceRows.some((r) => r.priority === 'goal' && r.name === 'CIM Marathon'));
  assert.ok(raceRows.some((r) => r.priority === 'tune_up' && r.targetPaceSecPerKm === null));

  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.equal(planRows.length, res.weeks);

  // The athlete's paceConfig was persisted (VDOT anchor from the recent race).
  const [a] = await db.select().from(athletes).where(eq(athletes.id, A));
  assert.ok(a.paceConfig, 'paceConfig persisted');
  assert.equal(a.goalRace, 'CIM Marathon');
});

test('re-running setup replaces races + plan (idempotent, no pile-up)', async () => {
  await setupSeason(db, A, INPUT);
  const raceRows = await db.select().from(races).where(eq(races.athleteId, A));
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.equal(raceRows.length, 2, 'races replaced, not duplicated');
  // one plans row per week, not doubled
  const weekStarts = new Set(planRows.map((p) => p.weekStart));
  assert.equal(weekStarts.size, planRows.length);
});

test('getSeasonPlan returns weeks in order with races', async () => {
  const { weeks, races: raceRows } = await getSeasonPlan(db, A);
  assert.ok(weeks.length > 12);
  for (let i = 1; i < weeks.length; i++) assert.ok(weeks[i].weekStart > weeks[i - 1].weekStart);
  assert.equal(raceRows.length, 2);
});

test('getUpcomingWeeks returns the next N weeks with day-by-day sessions', async () => {
  const upcoming = await getUpcomingWeeks(db, A, INPUT.startDay, 4);
  assert.ok(upcoming.length > 0 && upcoming.length <= 4);
  // chronological, all on/after today, and each has sessions
  let prev = '';
  for (const w of upcoming) {
    assert.ok(w.weekStart > prev);
    prev = w.weekStart;
    assert.ok(w.weekEnd >= INPUT.startDay);
    assert.ok(w.sessions.length >= 1);
  }
});
