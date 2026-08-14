/**
 * Triathlon onboarding integration test — the athlete-facing path that sets the
 * three anchors from scratch and generates a published multi-sport plan.
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
import { setupAthleteTriGoal } from '../athleteTriGoal';
import { getTriGoalTracker } from '../triGoalTracker';
import { getAthleteFtp, getAthleteWeightKg } from '@/db/powerConfig';
import { getAthleteCss } from '@/db/swimConfig';
import { getAthleteVdot } from '@/db/paceConfig';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '66666666-6666-4666-8666-666666666666';

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
  // A brand-new athlete — NO anchors yet (onboarding sets them).
  await db.insert(athletes).values({ id: A, fullName: 'New Tri', email: 'new-tri@example.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

test('onboarding sets all three anchors + DOB and builds a published timed plan', async () => {
  const res = await setupAthleteTriGoal(db, A, '2026-08-17', {
    distance: '70.3',
    date: '2027-06-13',
    targetFinishSeconds: 5 * 3600 + 30 * 60,
    weeklyHours: 8,
    limiter: 'swim',
    run: { race: { distanceMeters: 10000, timeSeconds: 44 * 60 } },
    bike: { ftpWatts: 240, weightKg: 74 },
    swim: { test: { t400Sec: 400, t200Sec: 190 } }, // 6:40 / 3:10 → CSS ~0.95 m/s
    dateOfBirth: '1975-01-01',
  });

  // Anchors were set from the form inputs.
  assert.ok((await getAthleteVdot(db, A))! > 40, 'run VDOT set from the 10K');
  assert.equal(await getAthleteFtp(db, A), 240);
  assert.equal(await getAthleteWeightKg(db, A), 74);
  const css = await getAthleteCss(db, A);
  assert.ok(css! > 0.9 && css! < 1.0, `CSS ~0.95 from the 400/200 test (${css})`);

  // DOB persisted (drives the ceiling) + autonomous onboarding.
  const [ath] = await db.select().from(athletes).where(eq(athletes.id, A));
  assert.equal(ath.dateOfBirth, '1975-01-01');
  assert.equal(ath.coachingMode, 'autonomous');
  assert.ok(ath.onboardedAt, 'marked onboarded');

  // A timed goal race + a published plan per sport.
  const [race] = await db.select().from(races).where(eq(races.athleteId, A));
  assert.equal(race.goalType, 'time');
  assert.equal(race.targetTimeSeconds, 5 * 3600 + 30 * 60);
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.equal(new Set(planRows.map((p) => p.discipline)).size, 3);
  assert.ok(planRows.every((p) => p.status === 'published'));

  // The setup result carried the verdict, and the portal tracker agrees.
  assert.ok(res.feasibility, 'verdict returned');
  const tracker = await getTriGoalTracker(db, A, '2026-08-17');
  assert.ok(tracker);
  assert.equal(tracker!.feasibility.verdict, res.feasibility!.verdict);
});

test('onboarding rejects a race date in the past', async () => {
  await assert.rejects(
    setupAthleteTriGoal(db, A, '2026-08-17', {
      distance: '70.3',
      date: '2025-01-01',
      weeklyHours: 8,
      limiter: 'swim',
      run: { race: { distanceMeters: 10000, timeSeconds: 44 * 60 } },
      bike: { ftpWatts: 240 },
      swim: { test: { t400Sec: 400, t200Sec: 190 } },
    }),
    /future/,
  );
});
