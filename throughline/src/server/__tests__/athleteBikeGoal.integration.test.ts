/**
 * Standalone cycling onboarding integration test — sets the FTP anchor and
 * generates a published bike-only plan for a brand-new athlete.
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
import { setupAthleteBikeGoal } from '../athleteBikeGoal';
import { getAthleteFtp, getAthleteWeightKg } from '@/db/powerConfig';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '88888888-8888-4888-8888-888888888888';

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
  await db.insert(athletes).values({ id: A, fullName: 'New Cyclist', email: 'cyclist@example.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

test('cycling onboarding sets FTP and builds a published bike-only plan', async () => {
  const res = await setupAthleteBikeGoal(db, A, '2026-08-17', {
    eventName: 'Autumn Gran Fondo',
    date: '2027-05-01',
    weeklyHours: 6,
    ftpWatts: 245,
    weightKg: 78,
    dateOfBirth: '1980-03-15',
  });
  assert.ok(res.weeks > 0, 'a multi-week plan was generated');
  assert.ok(res.peakTss > 0);

  assert.equal(await getAthleteFtp(db, A), 245);
  assert.equal(await getAthleteWeightKg(db, A), 78);

  const [ath] = await db.select().from(athletes).where(eq(athletes.id, A));
  assert.equal(ath.dateOfBirth, '1980-03-15');
  assert.equal(ath.coachingMode, 'autonomous');
  assert.ok(ath.onboardedAt);
  assert.equal(ath.goalRace, 'Autumn Gran Fondo');

  const [race] = await db.select().from(races).where(eq(races.athleteId, A));
  assert.equal(race.name, 'Autumn Gran Fondo');
  assert.equal(race.priority, 'goal');

  // Every persisted plan is a BIKE plan — this is a standalone cycling athlete.
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, A));
  assert.ok(planRows.length > 0);
  assert.ok(planRows.every((p) => p.discipline === 'bike'), 'all plans are bike-discipline');
  assert.ok(planRows.every((p) => p.status === 'published'));
});

test('cycling onboarding rejects a past event date and a missing FTP', async () => {
  await assert.rejects(
    setupAthleteBikeGoal(db, A, '2026-08-17', { date: '2025-01-01', weeklyHours: 6, ftpWatts: 245 }),
    /future/,
  );
  await assert.rejects(
    setupAthleteBikeGoal(db, A, '2026-08-17', { date: '2027-05-01', weeklyHours: 6, ftpWatts: 0 }),
    /FTP/,
  );
});
