/**
 * Athlete merge integration test — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, activities, races } from '@/db/schema';
import { mergeAthletes } from '../mergeAthletes';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const SRC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // Tanner-like (has activities)
const TGT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Hill-like (has a race)

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
  await db.insert(athletes).values([
    { id: SRC, fullName: 'Heather Tanner', email: 'tanner@x.com', timezone: 'UTC' },
    { id: TGT, fullName: 'Heather Hill', email: 'hill@x.com', timezone: 'UTC' },
  ]);
  await db.insert(activities).values([
    { athleteId: SRC, sport: 'run', startTime: new Date('2014-01-01T12:00:00Z'), distanceMeters: 16093, sourceRef: 'manual:src:2014-01-01' },
    { athleteId: SRC, sport: 'run', startTime: new Date('2014-01-02T12:00:00Z'), distanceMeters: 16093, sourceRef: 'manual:src:2014-01-02' },
  ]);
  await db.insert(races).values({ athleteId: TGT, name: 'Valencia', date: '2026-12-06', priority: 'goal' });
});

after(async () => {
  await client.close();
});

test('merge moves the source athlete records to the target and deletes the source', async () => {
  const res = await mergeAthletes(db, SRC, TGT);
  assert.equal(res.sourceName, 'Heather Tanner');
  assert.equal(res.targetName, 'Heather Hill');

  // Activities now belong to the target; the target keeps its race.
  const tgtActs = await db.select().from(activities).where(eq(activities.athleteId, TGT));
  assert.equal(tgtActs.length, 2);
  const tgtRaces = await db.select().from(races).where(eq(races.athleteId, TGT));
  assert.equal(tgtRaces.length, 1);

  // Source is gone.
  const remaining = await db.select().from(athletes);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, TGT);
});

test('merging an athlete into itself is rejected', async () => {
  await assert.rejects(() => mergeAthletes(db, TGT, TGT));
});
