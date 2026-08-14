/**
 * Integration test for plan persistence against REAL Postgres, in-process via
 * PGlite — no hosted DB required. Applies the generated migration, then
 * exercises persist → read round-trip, publish/supersede, and the diff.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';

import * as schema from '../schema';
import { plans } from '../schema';
import {
  persistPlanDraft,
  getPlanWeek,
  publishPlan,
  toSessionType,
} from '../plans';
import {
  buildZones,
  estimateThresholdSecPerKm,
  generatePlan,
  diffWeek,
  adaptWeek,
  resolvePowerZones,
} from '@/engine/plan';

let client: PGlite;
// drizzle's pglite type satisfies the PgDatabase the persistence layer expects.
let db: ReturnType<typeof drizzle<typeof schema>>;

const athleteId = '11111111-1111-1111-1111-111111111111';

const zones = buildZones(estimateThresholdSecPerKm({ distanceMeters: 21097.5, timeSeconds: 73 * 60 }));
const planInput = {
  startDay: '2026-01-05',
  goalRaceDay: '2026-04-12',
  startVolumeMiles: 55,
  peakVolumeMiles: 72,
};

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });

  // Apply the generated migration (split on drizzle's statement breakpoints).
  const sql = readdirSync(join(process.cwd(), 'drizzle'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8'))
    .join('\n--> statement-breakpoint\n');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }

  // Seed the athlete (FK target).
  await db.insert(schema.athletes).values({
    id: athleteId,
    fullName: 'Test Athlete',
    email: 'test@example.com',
    timezone: 'America/Los_Angeles',
  });
});

after(async () => {
  await client.close();
});

test('toSessionType maps quality zones to the right enum values', () => {
  assert.equal(toSessionType('quality', 'threshold'), 'threshold');
  assert.equal(toSessionType('quality', 'interval'), 'intervals');
  assert.equal(toSessionType('quality', 'marathon'), 'marathon');
  assert.equal(toSessionType('maintenance', null), 'maintenance');
  assert.equal(toSessionType('long', 'easy'), 'long');
});

test('persist a draft plan and read one week back as an engine PlannedWeek', async () => {
  const weeks = generatePlan(planInput, zones);
  const persisted = await persistPlanDraft(db, athleteId, weeks, zones, planInput);
  assert.equal(persisted.length, weeks.length);

  const w0 = weeks[0];
  const loaded = await getPlanWeek(db, athleteId, w0.weekStart);
  assert.ok(loaded, 'week should load');
  assert.equal(loaded!.status, 'draft');
  assert.equal(loaded!.week.days.length, w0.days.length);

  // Round-trip fidelity on the key fields.
  const origLong = w0.days.find((d) => d.runType === 'long')!;
  const loadedLong = loaded!.week.days.find((d) => d.runType === 'long')!;
  assert.equal(Math.round(loadedLong.distanceMeters), Math.round(origLong.distanceMeters));
  assert.equal(loaded!.week.phase, w0.phase);
  assert.equal(loaded!.week.cycle, w0.cycle);
});

test('pace bounds are persisted from the zone (numeric, queryable)', async () => {
  const w0 = generatePlan(planInput, zones)[0];
  const loaded = await getPlanWeek(db, athleteId, w0.weekStart);
  const quality = loaded!.week.days.find((d) => d.runType === 'quality');
  assert.ok(quality, 'has a quality day');

  // Read the raw row to confirm numeric pace bounds landed.
  const [row] = await db
    .select()
    .from(schema.plannedSessions)
    .where(eq(schema.plannedSessions.day, quality!.day));
  assert.ok(row.targetPaceFastSecPerKm! < row.targetPaceSlowSecPerKm!, 'fast bound faster than slow');
  assert.ok(row.segments, 'workout segments persisted');
});

test('publish flips draft → published and supersedes a prior published week', async () => {
  const weeks = generatePlan(planInput, zones);
  const weekStart = weeks[0].weekStart;

  // First published plan for the week.
  const first = await persistPlanDraft(db, athleteId, [weeks[0]], zones);
  await publishPlan(db, first[0].planId);
  let pub = await getPlanWeek(db, athleteId, weekStart, 'published');
  assert.equal(pub!.planId, first[0].planId);

  // A replan → new draft → publish supersedes the first.
  const second = await persistPlanDraft(db, athleteId, [weeks[0]], zones);
  await publishPlan(db, second[0].planId);

  pub = await getPlanWeek(db, athleteId, weekStart, 'published');
  assert.equal(pub!.planId, second[0].planId, 'newest published wins');

  const [firstRow] = await db.select().from(plans).where(eq(plans.id, first[0].planId));
  assert.equal(firstRow.status, 'superseded', 'prior published is superseded');
});

test('a cycling plan persists as duration-at-power (additive TSS/watt columns)', async () => {
  const power = resolvePowerZones({ ftpWatts: 250 });
  const bikeWeeks = generatePlan(
    { startDay: '2026-01-05', goalRaceDay: '2026-06-14', startVolumeMiles: 350, peakVolumeMiles: 620, discipline: 'bike' },
    power,
  );
  const build = bikeWeeks.find((w) => w.phase === 'build')!;
  await persistPlanDraft(db, athleteId, [build], power, { discipline: 'bike' });

  const [planRow] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.weekStart, build.weekStart), eq(plans.discipline, 'bike')))
    .limit(1);
  assert.equal(planRow.discipline, 'bike');
  assert.equal(planRow.weeklyTargetMeters, null, 'no meters on a bike plan');
  assert.ok((planRow.weeklyTargetTss ?? 0) > 0, 'weekly TSS persisted');

  // A quality session round-trips with duration + watt band, no pace.
  const rows = await db
    .select()
    .from(schema.plannedSessions)
    .where(eq(schema.plannedSessions.planId, planRow.id));
  const thr = rows.find((r) => r.zone === 'threshold')!;
  assert.equal(thr.discipline, 'bike');
  assert.ok((thr.targetDurationSeconds ?? 0) > 0, 'duration persisted');
  assert.ok((thr.targetPowerLowWatts ?? 0) > 0 && (thr.targetPowerHighWatts ?? 0) > 0, 'watt band persisted');
  assert.equal(thr.targetPaceSecPerKm, null, 'no pace on a bike session');
  assert.equal(thr.targetDistanceMeters, null, 'no distance on a bike session');
});

test('diff highlights what an adaptation changes vs the published week', async () => {
  const weeks = generatePlan(planInput, zones);
  const buildWeek = weeks.find((w) => w.phase === 'build')!;

  // Adapt the week (athlete unready on the quality day) and diff against original.
  const quality = buildWeek.days.find((d) => d.runType === 'quality')!;
  const { week: adapted } = adaptWeek(buildWeek, { readiness: { [quality.day]: 'easy' } });

  const diff = diffWeek(buildWeek, adapted);
  assert.ok(diff.changedCount >= 1);
  const changedDay = diff.days.find((d) => d.day === quality.day)!;
  assert.equal(changedDay.kind, 'changed');
  assert.ok(changedDay.fields.includes('runType'));
});
