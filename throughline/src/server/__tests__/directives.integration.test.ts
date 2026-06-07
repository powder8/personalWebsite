/**
 * Directive (windowed adjustment) integration test — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '@/db/schema';
import { athletes } from '@/db/schema';
import { createDirective, listActiveDirectives, deactivateDirective } from '../directives';
import { applyDirectives } from '@/engine/plan';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '99999999-9999-4999-8999-999999999999';

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readFileSync(join(process.cwd(), 'drizzle', '0000_init.sql'), 'utf8');
  for (const s of sql.split('--> statement-breakpoint')) {
    const t = s.trim();
    if (t) await client.exec(t);
  }
  await db.insert(athletes).values({ id: A, fullName: 'Dir Test', email: 'dir@x.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

test('create → list → apply round-trip (athlete unavailable window → rest)', async () => {
  await createDirective(db, A, {
    type: 'unavailable',
    from: '2026-06-10',
    to: '2026-06-12',
    label: 'Out of town',
  });
  await createDirective(db, A, { type: 'pace_adjust', from: '2026-06-15', to: null, deltaSecPerMile: 15 });

  const dirs = await listActiveDirectives(db, A);
  assert.equal(dirs.length, 2);

  // A session inside the travel window becomes rest.
  const adj = applyDirectives(
    { day: '2026-06-11', sessionType: 'long', distanceMeters: 25000, paceFastSecPerKm: 300, paceSlowSecPerKm: 320 },
    dirs,
  );
  assert.equal(adj.sessionType, 'rest');
  assert.ok(adj.adjustments.some((a) => /Out of town/.test(a)));

  // A session in the ongoing pace window is slowed.
  const adj2 = applyDirectives(
    { day: '2026-07-01', sessionType: 'easy', distanceMeters: 10000, paceFastSecPerKm: 300, paceSlowSecPerKm: 320 },
    dirs,
  );
  assert.ok(adj2.paceFastSecPerKm! > 300);
});

test('deactivating a directive removes it from the active set', async () => {
  const [first] = await listActiveDirectives(db, A);
  await deactivateDirective(db, first.id);
  const dirs = await listActiveDirectives(db, A);
  assert.ok(!dirs.some((d) => d.id === first.id));
});
