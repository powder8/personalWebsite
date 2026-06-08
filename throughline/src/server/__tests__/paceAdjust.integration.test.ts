/**
 * Pace adjustment integration test — real Postgres via PGlite.
 * Adjusting a zone updates the athlete's model, logs an override, and re-applies
 * to future sessions.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, plannedSessions, plans, overrides } from '@/db/schema';
import { setupSeason } from '../season';
import { adjustAthleteZones } from '../paceAdjust';

const TODAY = '2026-06-06';
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '77777777-7777-4777-8777-777777777777';

async function thresholdPaces(): Promise<number[]> {
  const rows = await db
    .select({ pace: plannedSessions.targetPaceFastSecPerKm, day: plannedSessions.day })
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(and(eq(plannedSessions.athleteId, A), eq(plannedSessions.zone, 'threshold')));
  return rows.filter((r) => r.day >= TODAY && r.pace != null).map((r) => r.pace as number);
}

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
  await db.insert(athletes).values({ id: A, fullName: 'Pace Test', email: 'pace@x.com', timezone: 'UTC' });
  await setupSeason(db, A, {
    startDay: TODAY,
    goalRace: { name: 'Goal', date: '2026-09-06', distanceLabel: 'Marathon', distanceMeters: 42195, priority: 'goal' },
    fitness: { race: { distanceMeters: 21097.5, timeSeconds: 80 * 60 } },
    startVolumeMiles: 40,
    peakVolumeMiles: 55,
  });
});

after(async () => {
  await client.close();
});

test('slowing threshold updates the model, logs an override, and re-applies to future sessions', async () => {
  const beforePaces = await thresholdPaces();
  assert.ok(beforePaces.length > 0, 'there are future threshold sessions');

  const res = await adjustAthleteZones(db, A, { threshold: 20 }, { today: TODAY }); // +20 s/mi slower
  assert.ok(res.updatedSessions > 0);
  assert.equal(res.reasonCode, 'too_aggressive'); // slowing ⇒ was too aggressive

  // Model persisted.
  const [a] = await db.select().from(athletes).where(eq(athletes.id, A));
  const cfg = a.paceConfig as { zoneOverrides?: { threshold?: { slowAdjust?: number } } };
  assert.ok(cfg.zoneOverrides?.threshold?.slowAdjust && cfg.zoneOverrides.threshold.slowAdjust > 0);

  // Future threshold paces are now slower (larger sec/km).
  const afterPaces = await thresholdPaces();
  const beforeAvg = beforePaces.reduce((s, x) => s + x, 0) / beforePaces.length;
  const afterAvg = afterPaces.reduce((s, x) => s + x, 0) / afterPaces.length;
  assert.ok(afterAvg > beforeAvg + 5, `threshold should be ~12 s/km slower (before ${beforeAvg.toFixed(1)}, after ${afterAvg.toFixed(1)})`);

  // Override recorded as labeled data.
  const ovr = await db.select().from(overrides).where(eq(overrides.athleteId, A));
  assert.ok(ovr.some((o) => o.targetType === 'pace_model' && o.reasonCode === 'too_aggressive'));
});

test('a pinned session is not overwritten by a model re-apply', async () => {
  // Pin one future threshold session at a fixed pace.
  const [pinned] = await db
    .select()
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(and(eq(plannedSessions.athleteId, A), eq(plannedSessions.zone, 'threshold')))
    .limit(1);
  const sessionId = pinned.planned_sessions.id;
  await db
    .update(plannedSessions)
    .set({ pinned: true, targetPaceFastSecPerKm: 999 })
    .where(eq(plannedSessions.id, sessionId));

  await adjustAthleteZones(db, A, { threshold: 30 }, { today: TODAY });

  const [row] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, sessionId));
  assert.equal(row.targetPaceFastSecPerKm, 999, 'pinned session untouched');
});
