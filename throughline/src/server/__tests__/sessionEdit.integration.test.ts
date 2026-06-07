/**
 * Per-session edit integration test — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, plannedSessions, plans, overrides } from '@/db/schema';
import { setupSeason } from '../season';
import { editSession } from '../sessionEdit';
import { adjustAthleteZones } from '../paceAdjust';

const TODAY = '2026-06-06';
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '88888888-8888-4888-8888-888888888888';

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readFileSync(join(process.cwd(), 'drizzle', '0000_init.sql'), 'utf8');
  for (const s of sql.split('--> statement-breakpoint')) {
    const t = s.trim();
    if (t) await client.exec(t);
  }
  await db.insert(athletes).values({ id: A, fullName: 'Edit Test', email: 'edit@x.com', timezone: 'UTC' });
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

async function aFutureThreshold() {
  const [row] = await db
    .select()
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(and(eq(plannedSessions.athleteId, A), eq(plannedSessions.zone, 'threshold')))
    .limit(1);
  return row.planned_sessions;
}

test('editing a session pins it, applies edits, and logs an override with a reason', async () => {
  const s = await aFutureThreshold();
  await editSession(
    db,
    s.id,
    { distanceMiles: 4, sessionType: 'easy', description: 'Swapped to easy — travel day' },
    { reasonCode: 'travel', note: 'red-eye flight' },
  );

  const [after] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, s.id));
  assert.equal(after.pinned, true);
  assert.equal(after.sessionType, 'easy');
  assert.equal(Math.round((after.targetDistanceMeters ?? 0) / 1609.344), 4);
  assert.match(after.description ?? '', /Swapped to easy/);

  const ovr = await db.select().from(overrides).where(eq(overrides.targetId, s.id));
  assert.equal(ovr.length, 1);
  assert.equal(ovr[0].reasonCode, 'travel');
  assert.equal(ovr[0].targetType, 'planned_session');
});

test('a pinned (edited) session survives a later pace-model re-apply', async () => {
  const s = await aFutureThreshold();
  await editSession(db, s.id, { paceFastSecPerMile: 360, paceSlowSecPerMile: 370 }, { reasonCode: 'athlete_request' });
  const [pinnedAfterEdit] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, s.id));
  const pinnedPace = pinnedAfterEdit.targetPaceFastSecPerKm;

  // A model-wide pace change must NOT overwrite the pinned session.
  await adjustAthleteZones(db, A, { threshold: 40 }, { today: TODAY });
  const [afterReapply] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, s.id));
  assert.equal(afterReapply.targetPaceFastSecPerKm, pinnedPace, 'pinned pace preserved');
});
