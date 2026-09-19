import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/db/schema';
import { athletes, activities } from '@/db/schema';
import { buildState, disagreements, DISAGREE_CONFIDENCE, type ActivityJudgment, type ActivityFacts } from '../activityJudgmentLogic';
import { judgeUnjudgedActivities, listDisagreements, type Judge } from '../activityJudgment';

// ---- pure ------------------------------------------------------------------

const facts = (o: Partial<ActivityFacts> = {}): ActivityFacts => ({
  name: 'Lunch Ride', providerSport: 'bike', workoutType: null, distanceMeters: 38900, durationSeconds: 4633,
  avgHr: 138, maxHr: 161, cadence: 88, elevationGainMeters: 261, surface: null, ...o,
});
const judgment = (o: Partial<ActivityJudgment> = {}): ActivityJudgment => ({
  sport: 'bike', confidence: 0.95, probabilities: { run: 0.02, bike: 0.95, swim: 0, strength: 0.01, walk: 0.01, other: 0.01 },
  race: 0.05, model: 'jev-latest', judgedAt: '2026-09-19T12:00:00Z', ...o,
});

test('state exposes the numbers that make the sport obvious, in plain units', () => {
  const s = buildState(facts());
  assert.equal(s.distance_km, 38.9);
  assert.equal(s.duration_min, 77);
  assert.ok(Math.abs((s.avg_speed_kph as number) - 30.2) < 0.15, `speed ${s.avg_speed_kph}`);
  assert.ok(Math.abs((s.avg_pace_min_per_km as number) - 2.0) < 0.05);
  assert.equal(s.provider_says, 'bike');
  assert.equal(s.provider_flagged_race, false);
  assert.match(s.cadence!.note, /revolutions/);
});

test('state handles missing numbers without dividing by zero', () => {
  const s = buildState(facts({ distanceMeters: null, durationSeconds: null, cadence: null }));
  assert.equal(s.distance_km, null);
  assert.equal(s.avg_speed_kph, null);
  assert.equal(s.avg_pace_min_per_km, null);
  assert.equal(s.cadence, null);
});

test('agreement → no disagreement, however confident', () => {
  assert.deepEqual(disagreements('bike', null, judgment()), []);
});

test('a CONFIDENT different sport is flagged; a hesitant one is not', () => {
  const sure = disagreements('bike', null, judgment({ sport: 'run', confidence: 0.9 }));
  assert.equal(sure.length, 1);
  assert.deepEqual(sure[0], { kind: 'sport', from: 'bike', to: 'run', confidence: 0.9 });
  const hesitant = disagreements('bike', null, judgment({ sport: 'run', confidence: DISAGREE_CONFIDENCE - 0.05 }));
  assert.deepEqual(hesitant, [], 'below the confidence floor the model just does not get a vote');
});

test('"this looks like a race" is flagged only when the provider did NOT already say so', () => {
  assert.deepEqual(disagreements('run', null, judgment({ sport: 'run', race: 0.92 })), [{ kind: 'race', probability: 0.92 }]);
  assert.deepEqual(disagreements('run', 1, judgment({ sport: 'run', race: 0.92 })), [], 'Strava already flagged it');
  assert.deepEqual(disagreements('run', null, judgment({ sport: 'run', race: 0.6 })), [], 'not confident enough');
});

// ---- storage + batching, with a fake judge ---------------------------------

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '99999999-9999-4999-8999-999999999999';
const at = (d: string) => new Date(`${d}T12:00:00.000Z`);

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readdirSync(join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8')).join('\n--> statement-breakpoint\n');
  for (const s of sql.split('--> statement-breakpoint')) { const t = s.trim(); if (t) await client.exec(t); }
  await db.insert(athletes).values({ id: A, fullName: 'Judged', email: 'judged@e.com', timezone: 'UTC' });
  await db.insert(activities).values([
    // Logged as a RUN but the numbers say bike (30 km/h, 88 rpm).
    { athleteId: A, sport: 'run', name: 'Morning Run', startTime: at('2026-09-18'), distanceMeters: 38900, durationSeconds: 4633, avgHr: 138, cadence: 88 },
    // A genuine run.
    { athleteId: A, sport: 'run', name: 'Easy 5', startTime: at('2026-09-17'), distanceMeters: 8000, durationSeconds: 2700, avgHr: 145, cadence: 172 },
  ]);
});
after(async () => { await client.close(); });

/** A deterministic stand-in for TypeSafe: classifies by speed. */
const fakeJudge: Judge = async (f) => {
  const kph = f.distanceMeters && f.durationSeconds ? (f.distanceMeters / 1000) / (f.durationSeconds / 3600) : 0;
  const bike = kph > 18;
  return judgment({
    sport: bike ? 'bike' : 'run',
    confidence: 0.93,
    probabilities: { run: bike ? 0.05 : 0.93, bike: bike ? 0.93 : 0.05, swim: 0, strength: 0.01, walk: 0.01, other: 0 },
  });
};

test('unjudged activities get judged and stored; sport itself is untouched (shadow mode)', async () => {
  const res = await judgeUnjudgedActivities(db, A, { judge: fakeJudge });
  assert.equal(res.judged, 2);
  assert.equal(res.skipped, null);
  const rows = await db.select().from(activities);
  assert.ok(rows.every((r) => r.judgment != null), 'every row carries a judgment');
  assert.ok(rows.every((r) => r.sport === 'run'), 'the provider sport was NOT changed');
});

test('a second pass finds nothing left to judge', async () => {
  const res = await judgeUnjudgedActivities(db, A, { judge: fakeJudge });
  assert.equal(res.judged, 0);
});

test('the disagreement list shows exactly the mislabelled ride', async () => {
  const { judged, rows } = await listDisagreements(db, A);
  assert.equal(judged, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Morning Run');
  assert.deepEqual(rows[0].disagreements[0], { kind: 'sport', from: 'run', to: 'bike', confidence: 0.93 });
});

test('without a key and without an injected judge, it quietly does nothing', async () => {
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    assert.deepEqual(await judgeUnjudgedActivities(db, A), { judged: 0, skipped: 'unconfigured' });
  } finally {
    if (saved != null) process.env.TYPESAFE_API_KEY = saved;
  }
});
