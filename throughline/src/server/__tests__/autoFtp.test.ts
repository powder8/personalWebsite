import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { athletes, activities } from '@/db/schema';
import type { AthletePowerConfig } from '@/engine/plan';
import { decideFtpUpdate, ftpOrigin, shouldCheckFtp, type FtpEstimate } from '../ftpAnchorLogic';
import { ensureAutoFtp, trackFtpFromRides, getFtpProvenance, type FtpEstimator } from '../autoFtp';

const est = (ftpWatts: number, confidence: FtpEstimate['confidence'] = 'high', sampleSize = 3): FtpEstimate => ({ ftpWatts, confidence, sampleSize });

// ---- provenance ---------------------------------------------------------------

test('origin: tagged starter / legacy auto → starter; untagged → manual (never overwrite a typed FTP)', () => {
  assert.equal(ftpOrigin({ anchorSource: 'auto', ftpBasis: 'starter' }), 'starter');
  assert.equal(ftpOrigin({ anchorSource: 'auto' }), 'starter', 'pre-existing auto FTPs were all body-mass guesses');
  assert.equal(ftpOrigin({ anchorSource: 'auto', ftpBasis: 'rides' }), 'rides');
  assert.equal(ftpOrigin({ anchorSource: 'manual' }), 'manual');
  assert.equal(ftpOrigin({}), 'manual', 'bike-goal setup used to store a typed FTP untagged');
});

// ---- decision -------------------------------------------------------------------

const base = { currentFtp: 165, origin: 'starter' as const, autonomous: true, estimate: est(212) };

test('no ride power → keep what we have', () => {
  assert.equal(decideFtpUpdate({ ...base, estimate: null }).set, false);
});

test('a starter guess yields to any demonstrated power, up or down, even one ride', () => {
  assert.equal(decideFtpUpdate(base).set, true);
  assert.equal(decideFtpUpdate({ ...base, estimate: est(140, 'low', 1) }).set, true);
});

test('ride-based FTP: rises follow the rides; tiny moves are ignored', () => {
  const rides = { ...base, origin: 'rides' as const, currentFtp: 210 };
  assert.equal(decideFtpUpdate({ ...rides, estimate: est(222, 'low', 1) }).set, true, 'up 5.7%');
  assert.equal(decideFtpUpdate({ ...rides, estimate: est(213) }).set, false, 'up 1.4%: churn');
});

test('ride-based FTP only goes DOWN with several rides behind it', () => {
  const rides = { ...base, origin: 'rides' as const, currentFtp: 210 };
  assert.equal(decideFtpUpdate({ ...rides, estimate: est(190, 'medium', 2) }).set, false);
  assert.equal(decideFtpUpdate({ ...rides, estimate: est(190, 'high', 4) }).set, true);
  assert.equal(decideFtpUpdate({ ...rides, estimate: est(203, 'high', 4) }).set, false, 'down 3.3%: not enough');
});

test('an entered FTP is respected, except a self-coached rider clearly beating it', () => {
  const manual = { ...base, origin: 'manual' as const, currentFtp: 230 };
  assert.equal(decideFtpUpdate({ ...manual, estimate: est(200) }).set, false, 'never lowered');
  assert.equal(decideFtpUpdate({ ...manual, estimate: est(236) }).set, false, 'only +2.6%');
  assert.equal(decideFtpUpdate({ ...manual, estimate: est(245) }).set, true, '+6.5%, autonomous');
  assert.equal(decideFtpUpdate({ ...manual, autonomous: false, estimate: est(245) }).set, false, 'a coach owns it');
  assert.equal(decideFtpUpdate({ ...manual, estimate: est(245, 'low', 1) }).set, false, 'one ride is not enough to override');
});

// ---- throttle --------------------------------------------------------------------

test('check only when a ride could change the answer', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const ride = new Date('2026-10-16T17:00:00Z');
  assert.equal(shouldCheckFtp({ lastCheckedAt: null, latestRideStart: null, now }), false, 'no rides');
  assert.equal(shouldCheckFtp({ lastCheckedAt: null, latestRideStart: ride, now }), true, 'never checked');
  assert.equal(shouldCheckFtp({ lastCheckedAt: '2026-10-16T10:00:00Z', latestRideStart: ride, now }), true, 'new ride since');
  assert.equal(shouldCheckFtp({ lastCheckedAt: '2026-10-17T08:00:00Z', latestRideStart: ride, now }), false, 'nothing new');
  assert.equal(shouldCheckFtp({ lastCheckedAt: '2026-09-30T08:00:00Z', latestRideStart: new Date('2026-09-20T08:00:00Z'), now }), true, 'stale check');
});

// ---- end to end with a fake estimator --------------------------------------------

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-10-17T12:00:00Z');
const TODAY = '2026-10-17';

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readdirSync(join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8')).join('\n--> statement-breakpoint\n');
  for (const s of sql.split('--> statement-breakpoint')) { const t = s.trim(); if (t) await client.exec(t); }
  await db.insert(athletes).values({
    id: A, fullName: 'Rider', email: 'rider@e.com', timezone: 'UTC', coachingMode: 'autonomous',
    powerConfig: { ftpWatts: 165, weightKg: 75, anchorSource: 'auto', ftpBasis: 'starter' } satisfies AthletePowerConfig,
  });
});
after(async () => { await client.close(); });

let calls = 0;
const fakeEstimate = (ftp: number | null): FtpEstimator => async () => { calls++; return ftp == null ? null : est(ftp, 'high', 3); };
const cfgOf = async () => (await db.select().from(athletes).where(eq(athletes.id, A)))[0].powerConfig as AthletePowerConfig;

test('no rides yet → no Strava calls, starter stays', async () => {
  calls = 0;
  const r = await ensureAutoFtp(db, A, { today: TODAY, now: NOW, estimate: fakeEstimate(212) });
  assert.equal(r.status, 'skipped');
  assert.equal(calls, 0);
  assert.equal((await cfgOf()).ftpWatts, 165);
});

test('a synced ride with power replaces the starter guess', async () => {
  await db.insert(activities).values({ athleteId: A, provider: 'strava', sourceRef: 'strava:r1', sport: 'bike', startTime: new Date('2026-10-16T17:00:00Z'), durationSeconds: 3600 });
  const r = await ensureAutoFtp(db, A, { today: TODAY, now: NOW, estimate: fakeEstimate(212) });
  assert.equal(r.status, 'updated');
  assert.equal(r.previousFtp, 165);
  const cfg = await cfgOf();
  assert.equal(cfg.ftpWatts, 212);
  assert.equal(cfg.ftpBasis, 'rides');
  assert.equal(cfg.weightKg, 75, 'the rest of the power config survives');
  assert.deepEqual((await getFtpProvenance(db, A)).estimate, { confidence: 'high', sampleSize: 3, on: TODAY });
});

test('the next sync with no new ride makes no Strava calls', async () => {
  calls = 0;
  const r = await ensureAutoFtp(db, A, { today: TODAY, now: new Date(NOW.getTime() + 3600_000), estimate: fakeEstimate(230) });
  assert.equal(r.status, 'skipped');
  assert.equal(calls, 0);
});

test('a failed estimate is not recorded as a check (the next sync retries)', async () => {
  await db.insert(activities).values({ athleteId: A, provider: 'strava', sourceRef: 'strava:r2', sport: 'bike', startTime: new Date('2026-10-17T13:00:00Z'), durationSeconds: 3000 });
  const before = (await cfgOf()).autoFtpCheckedAt;
  const failing: FtpEstimator = async () => { throw new Error('Strava 429'); };
  await assert.rejects(ensureAutoFtp(db, A, { today: TODAY, now: new Date('2026-10-17T14:00:00Z'), estimate: failing }));
  assert.equal((await cfgOf()).autoFtpCheckedAt, before);
});

test('an entered FTP pins it; "let my rides set it" hands it back', async () => {
  await db.update(athletes).set({ powerConfig: { ...(await cfgOf()), ftpWatts: 250, anchorSource: 'manual', ftpBasis: 'manual' } }).where(eq(athletes.id, A));
  const pinned = await ensureAutoFtp(db, A, { today: TODAY, now: new Date('2026-10-17T15:00:00Z'), estimate: fakeEstimate(215) });
  assert.equal(pinned.status, 'unchanged');
  assert.equal((await cfgOf()).ftpWatts, 250);

  await trackFtpFromRides(db, A);
  assert.equal((await getFtpProvenance(db, A)).origin, 'starter');
  const back = await ensureAutoFtp(db, A, { today: TODAY, now: new Date('2026-10-17T15:05:00Z'), estimate: fakeEstimate(215) });
  assert.equal(back.status, 'updated', 'checks immediately, no throttle wait');
  assert.equal((await cfgOf()).ftpWatts, 215);
});
