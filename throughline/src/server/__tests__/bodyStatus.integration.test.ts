import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { activities, athletes, dailySummaries, directives, healthEpisodes, hrvRecords, readinessAssessments, restingHrRecords, sleepRecords } from '@/db/schema';
import { addDays } from '@/engine';
import { applyDirectives } from '@/engine/plan';
import { evaluateBodyStatus, recordAthleteAction } from '../bodyStatus';
import { refreshAthleteHealth } from '../healthRefresh';
import { approveDirective, listActiveDirectives, listProposedDirectives } from '../directives';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const AUTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // self-coached
const COACHED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // assisted
const START = '2026-08-20';
const day = (i: number) => addDays(START, i);

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return (s + 1) / 4294967297;
  };
}

/** Seed `n` days of Whoop-like data; `sick` shifts vitals for a stretch. */
async function seed(athleteId: string, n: number, sick: { from: number; to: number; resp: number } | null, loadSpike: { from: number; to: number } | null, seedNo: number) {
  const r = rng(seedNo * 7919 + 1);
  const g = () => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
  const hrv = [];
  const rhr = [];
  const sleep = [];
  const daily = [];
  const acts = [];
  for (let i = 0; i < n; i++) {
    const on = sick && i >= sick.from && i <= sick.to;
    hrv.push({ athleteId, day: day(i), provider: 'whoop' as const, overnightAvgMs: 55 * (on ? 0.75 : 1) * Math.exp(0.12 * g()) });
    rhr.push({ athleteId, day: day(i), provider: 'whoop' as const, restingHr: Math.round(50 + (on ? 6 : 0) + 2 * g()) });
    sleep.push({ athleteId, day: day(i), provider: 'whoop' as const, totalSleepSeconds: Math.round((7.4 + 0.8 * g()) * 3600) });
    daily.push({ athleteId, day: day(i), provider: 'whoop' as const, respiratoryRate: 14.6 + (on ? sick!.resp : 0) + 0.35 * g(), skinTempC: 33.8 + (on && sick!.resp ? 0.5 : 0) + 0.25 * g(), spo2Pct: 96.5 + 0.7 * g() });
    if (i % 7 !== 6) {
      const mult = loadSpike && i >= loadSpike.from && i <= loadSpike.to ? 1.8 : 1;
      acts.push({ athleteId, provider: 'strava' as const, sourceRef: `strava:${athleteId}:${i}`, sport: 'run' as const, startTime: new Date(`${day(i)}T07:00:00Z`), durationSeconds: Math.round(3000 * mult), distanceMeters: 9000 * mult, avgHr: 142 });
    }
  }
  await db.insert(hrvRecords).values(hrv);
  await db.insert(restingHrRecords).values(rhr);
  await db.insert(sleepRecords).values(sleep);
  await db.insert(dailySummaries).values(daily);
  await db.insert(activities).values(acts);
}

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readdirSync(join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8')).join('\n--> statement-breakpoint\n');
  for (const s of sql.split('--> statement-breakpoint')) { const t = s.trim(); if (t) await client.exec(t); }
  await db.insert(athletes).values([
    { id: AUTO, fullName: 'Auto Athlete', email: 'auto@example.com', timezone: 'UTC', coachingMode: 'autonomous' },
    { id: COACHED, fullName: 'Coached Athlete', email: 'coached@example.com', timezone: 'UTC', coachingMode: 'assisted' },
  ]);
  // AUTO: healthy 45 days, then a 3-week illness (days 45–65), then healthy again.
  await seed(AUTO, 100, { from: 45, to: 65, resp: 1.2 }, null, 7);
  // COACHED: a load spike (days 40–52), then HRV/RHR off with no illness markers.
  await seed(COACHED, 64, { from: 50, to: 63, resp: 0 }, { from: 40, to: 52 }, 11);
});
after(async () => { await client.close(); });

const quality = (d: string) => ({ day: d, sessionType: 'intervals', distanceMeters: 10000, durationSeconds: 3000, paceFastSecPerKm: 230, paceSlowSecPerKm: 240 });
const planOn = async (athleteId: string, d: string, s = quality(d)) => applyDirectives(s, await listActiveDirectives(db, athleteId));
const bodyDirectives = async (athleteId: string) =>
  (await db.select().from(directives).where(and(eq(directives.athleteId, athleteId), eq(directives.active, true))))
    .filter((r) => (r.params as { category?: string }).category === 'body_status');

test('healthy: nothing is flagged and the plan is untouched', async () => {
  const r = await refreshAthleteHealth(db, AUTO, day(44));
  assert.ok(['ready', 'primed', 'watch'].includes(r.body!.status), r.body!.status);
  assert.equal((await bodyDirectives(AUTO)).length, 0);
  assert.equal((await planOn(AUTO, day(44))).sessionType, 'intervals');
});

test('illness, day 3: suspected, the hard session becomes easy, and readiness cannot say "go"', async () => {
  const today = day(47);
  const r = await refreshAthleteHealth(db, AUTO, today);
  assert.equal(r.body!.status, 'illness_suspected');
  assert.equal(r.body!.question, 'Are you feeling ill?');
  assert.ok(r.body!.evidence.some((e) => /Resting HR/.test(e)), r.body!.evidence.join(' | '));
  assert.ok(r.body!.evidence.some((e) => /Breathing rate/.test(e)));
  assert.equal(r.body!.planChanged, true);

  const adj = await planOn(AUTO, today);
  assert.equal(adj.sessionType, 'easy', 'intervals were converted to easy');
  assert.equal(adj.distanceMeters, 6000, 'at 60% volume');
  assert.equal(adj.paceFastSecPerKm, null, 'no pace targets carried over');
  assert.equal(r.recovery.readiness!.band, 'easy');
  const [persisted] = await db.select().from(readinessAssessments).where(and(eq(readinessAssessments.athleteId, AUTO), eq(readinessAssessments.day, today)));
  assert.equal(persisted.band, 'easy');
  const [ep] = await db.select().from(healthEpisodes).where(eq(healthEpisodes.athleteId, AUTO));
  assert.equal(ep.status, 'suspected');
  assert.equal(ep.kind, 'illness');
});

test('re-running the evaluation is idempotent: one episode, one directive, no churn', async () => {
  const before = await bodyDirectives(AUTO);
  const r = await refreshAthleteHealth(db, AUTO, day(47));
  assert.equal(r.body!.planChanged, false);
  const afterRows = await bodyDirectives(AUTO);
  assert.deepEqual(afterRows.map((d) => d.id), before.map((d) => d.id));
  assert.equal((await db.select().from(healthEpisodes).where(eq(healthEpisodes.athleteId, AUTO))).length, 1);
});

test('a race is never removed by an automatic hold', async () => {
  const race = { ...quality(day(48)), sessionType: 'race', distanceMeters: 21097 };
  assert.equal((await planOn(AUTO, day(48), race)).sessionType, 'race');
});

test('athlete confirms flu: the plan becomes rest, and keeps rolling forward while they are ill', async () => {
  let view = await recordAthleteAction(db, AUTO, day(47), 'sick_systemic');
  assert.equal(view!.status, 'ill');
  assert.equal((await planOn(AUTO, day(47))).sessionType, 'rest');
  assert.equal((await planOn(AUTO, day(50))).sessionType, 'rest');
  assert.equal((await planOn(AUTO, day(52))).sessionType, 'intervals', 'the hold is a short rolling window, not open-ended');

  // A week later, still ill: the window has moved with them.
  const r = await refreshAthleteHealth(db, AUTO, day(55));
  assert.equal(r.body!.status, 'ill');
  assert.equal((await planOn(AUTO, day(57))).sessionType, 'rest');
  view = r.body;
  assert.ok(view!.asks.some((a) => a.action === 'better'));
});

test('"I\'m better": a staged return scaled to three weeks down, then the plan is fully restored', async () => {
  const today = day(68);
  await refreshAthleteHealth(db, AUTO, today);
  const view = await recordAthleteAction(db, AUTO, today, 'better');
  assert.equal(view!.status, 'returning');
  assert.equal(view!.episode!.returnDays, 14);

  const s1 = await planOn(AUTO, today);
  assert.equal(s1.sessionType, 'easy');
  assert.equal(s1.distanceMeters, 5000, 'stage 1: half volume, easy');
  const s2 = await planOn(AUTO, addDays(today, 6));
  assert.equal(s2.sessionType, 'easy');
  assert.equal(s2.distanceMeters, 7500, 'stage 2: 75%, still easy');
  const s3 = await planOn(AUTO, addDays(today, 11));
  assert.equal(s3.sessionType, 'intervals', 'stage 3: real sessions are back');
  assert.equal(s3.distanceMeters, 9000, 'at 90%');
  assert.equal((await planOn(AUTO, addDays(today, 14))).distanceMeters, 10000, 'after the return window: untouched');

  // Two weeks on: resolved, nothing left on the plan.
  const done = await refreshAthleteHealth(db, AUTO, addDays(today, 15));
  assert.ok(['ready', 'primed', 'watch'].includes(done.body!.status), done.body!.status);
  assert.equal((await bodyDirectives(AUTO)).length, 0);
  const [ep] = await db.select().from(healthEpisodes).where(eq(healthEpisodes.athleteId, AUTO));
  assert.equal(ep.status, 'resolved');
  assert.ok(done.body!.history.some((h) => h.kind === 'illness' && h.days >= 18), 'the illness shows in the history');
});

test('coached athlete, overreaching: the change is PROPOSED to the coach, not applied', async () => {
  const today = day(55);
  const r = await refreshAthleteHealth(db, COACHED, today);
  assert.equal(r.body!.status, 'overreaching');
  assert.match(r.body!.body, /usual week/);
  assert.equal((await planOn(COACHED, today)).sessionType, 'intervals', 'plan unchanged until the coach approves');
  const proposals = await listProposedDirectives(db, COACHED);
  assert.ok(proposals.length >= 1);
  assert.equal((await bodyDirectives(COACHED)).length, 0, 'nothing active yet');

  // The coach approves; tomorrow's re-evaluation must not undo that approval.
  for (const p of proposals) await approveDirective(db, p.id);
  await refreshAthleteHealth(db, COACHED, day(56));
  assert.notEqual((await planOn(COACHED, day(58))).sessionType, 'intervals', 'the approved change is on the plan');
  assert.equal((await listProposedDirectives(db, COACHED)).length, 0, 'and it was not re-proposed');
});

test('coached athlete reports illness: applied at once (safety never waits on a coach)', async () => {
  const view = await recordAthleteAction(db, COACHED, day(56), 'sick_mild');
  assert.equal(view!.status, 'ill');
  const adj = await planOn(COACHED, day(56));
  assert.equal(adj.sessionType, 'easy');
  assert.equal(adj.distanceMeters, 5000);
});

test('"I feel fine" restores the plan and stops asking', async () => {
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.insert(athletes).values({ id: C, fullName: 'Fine Athlete', email: 'fine@example.com', timezone: 'UTC', coachingMode: 'autonomous' });
  await seed(C, 60, { from: 45, to: 59, resp: 0 }, null, 5);
  let r = await refreshAthleteHealth(db, C, day(50));
  assert.ok(['illness_suspected', 'strained', 'under_recovered'].includes(r.body!.status), r.body!.status);
  assert.equal((await planOn(C, day(50))).sessionType, 'easy');
  await recordAthleteAction(db, C, day(50), 'fine');
  assert.equal((await planOn(C, day(50))).sessionType, 'intervals');
  r = await refreshAthleteHealth(db, C, day(52));
  assert.equal(r.body!.question, null, 'not asked again two days later');
  assert.equal((await planOn(C, day(52))).sessionType, 'intervals');
});

test('progression is an offer the athlete accepts, and it is withdrawn if the body struggles', async () => {
  const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await db.insert(athletes).values({ id: P, fullName: 'Primed Athlete', email: 'primed@example.com', timezone: 'UTC', coachingMode: 'autonomous' });
  await seed(P, 70, { from: 62, to: 69, resp: 1.3 }, null, 3);
  const r = await evaluateBodyStatus(db, P, day(59), { apply: true });
  assert.equal(r!.view.status, 'primed');
  assert.equal((await planOn(P, day(59))).distanceMeters, 10000, 'nothing added automatically');
  await recordAthleteAction(db, P, day(59), 'progress');
  assert.equal((await planOn(P, day(60))).distanceMeters, 10600);
  await assert.rejects(recordAthleteAction(db, P, day(59), 'progress'), /only available/);
  // Illness starts on day 62: the extra volume goes away with the first hold.
  const sick = await refreshAthleteHealth(db, P, day(64));
  assert.equal(sick.body!.status, 'illness_suspected');
  assert.equal((await planOn(P, day(64))).distanceMeters, 6000);
});
