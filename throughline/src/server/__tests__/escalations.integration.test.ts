/**
 * Escalation review integration test — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, escalations } from '@/db/schema';
import {
  listEscalations,
  setEscalationStatus,
  countActiveEscalations,
  listEscalationsForAthlete,
} from '../escalations';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '66666666-6666-4666-8666-666666666666';

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readFileSync(join(process.cwd(), 'drizzle', '0000_init.sql'), 'utf8');
  for (const s of sql.split('--> statement-breakpoint')) {
    const t = s.trim();
    if (t) await client.exec(t);
  }
  await db.insert(athletes).values({ id: A, fullName: 'Esc Test', email: 'esc@x.com', timezone: 'UTC' });
  await db.insert(escalations).values([
    { athleteId: A, kind: 'active_injury', reason: 'injury' },
    { athleteId: A, kind: 'stale_data', reason: 'no data' },
  ]);
});

after(async () => {
  await client.close();
});

test('list returns active escalations joined with the athlete name', async () => {
  const rows = await listEscalations(db);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.athleteName === 'Esc Test'));
  assert.equal(await countActiveEscalations(db), 2);
});

test('acknowledge keeps it active; resolve drops it off the queue', async () => {
  const [first] = await listEscalations(db);
  await setEscalationStatus(db, first.id, 'acknowledged');
  assert.equal(await countActiveEscalations(db), 2, 'acknowledged still counts as active');

  await setEscalationStatus(db, first.id, 'resolved');
  assert.equal(await countActiveEscalations(db), 1, 'resolved removed from active');
  const active = await listEscalations(db);
  assert.ok(!active.some((r) => r.id === first.id));

  // resolvedAt stamped.
  const [row] = await db.select().from(escalations).where(eq(escalations.id, first.id));
  assert.ok(row.resolvedAt);
});

test('per-athlete list only shows active items', async () => {
  const rows = await listEscalationsForAthlete(db, A);
  assert.equal(rows.length, 1); // one was resolved above
});
