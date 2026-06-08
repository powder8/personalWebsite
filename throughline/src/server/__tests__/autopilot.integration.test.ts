/**
 * Autopilot integration test — real Postgres via PGlite. Verifies the approval
 * gate: assisted defers, autonomous+clean auto-publishes the draft, and
 * autonomous+injury holds and escalates.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import { and } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { athletes, injuryRecords, readinessAssessments, escalations, plans } from '@/db/schema';
import { setupSeason } from '../season';
import { runAutopilot, getOpenEscalations } from '../autopilot';

const TODAY = '2026-06-06';
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function id(n: number): string {
  return `5${n}000000-0000-4000-8000-000000000000`;
}

async function makeAthlete(athleteId: string, mode: 'assisted' | 'autonomous') {
  await db.insert(athletes).values({
    id: athleteId,
    fullName: `A${athleteId.slice(0, 2)}`,
    email: `${athleteId}@x.com`,
    timezone: 'UTC',
    coachingMode: mode,
  });
  // A season → a current-week draft plan to act on.
  await setupSeason(db, athleteId, {
    startDay: TODAY,
    goalRace: { name: 'Goal', date: '2026-09-06', distanceLabel: 'Marathon', distanceMeters: 42195, priority: 'goal' },
    fitness: { race: { distanceMeters: 21097.5, timeSeconds: 80 * 60 } },
    startVolumeMiles: 40,
    peakVolumeMiles: 55,
  });
  // Fresh data so we're not blocked on stale_data.
  await db.insert(readinessAssessments).values({ athleteId, day: TODAY, score: 70, band: 'go', sentence: 'ok' });
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
});

after(async () => {
  await client.close();
});

async function publishedCount(athleteId: string): Promise<number> {
  const rows = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), eq(plans.status, 'published')));
  return rows.length;
}

test('assisted mode never auto-publishes (leaves the draft for the coach)', async () => {
  const a = id(1);
  await makeAthlete(a, 'assisted');
  const res = await runAutopilot(db, a, { today: TODAY });
  assert.equal(res.decision, 'draft_assisted');
  assert.equal(await publishedCount(a), 0, 'nothing auto-published in assisted mode');
});

test('autonomous + clean state auto-publishes the current/next draft week', async () => {
  const a = id(2);
  await makeAthlete(a, 'autonomous');
  const res = await runAutopilot(db, a, { today: TODAY });
  assert.equal(res.decision, 'auto_publish');
  assert.ok(res.publishedPlanId, 'a plan was published');
  assert.equal(await publishedCount(a), 1, 'exactly one week published');
});

test('autonomous + active injury holds and records an escalation', async () => {
  const a = id(3);
  await makeAthlete(a, 'autonomous');
  await db.insert(injuryRecords).values({
    athleteId: a,
    bodyPart: 'achilles',
    severity: 'moderate',
    status: 'returning',
    onsetDate: TODAY,
  });
  const res = await runAutopilot(db, a, { today: TODAY });
  assert.equal(res.decision, 'hold_for_review');
  assert.ok(res.escalations.some((e) => e.kind === 'active_injury'));

  const open = await getOpenEscalations(db, a);
  assert.ok(open.some((e) => e.kind === 'active_injury'));

  // Re-running doesn't duplicate the open escalation.
  await runAutopilot(db, a, { today: TODAY });
  const open2 = await db.select().from(escalations).where(eq(escalations.athleteId, a));
  assert.equal(open2.filter((e) => e.kind === 'active_injury').length, 1);
});
