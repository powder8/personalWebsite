/**
 * Feedback capture/review integration test — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '@/db/schema';
import { createFeedback, listFeedback, setFeedbackStatus, countOpenFeedback } from '../feedback';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

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

test('feedback is captured with context and listed; addressing removes it from open count', async () => {
  await createFeedback(db, {
    author: 'Heather',
    path: '/athletes/abc/plan',
    category: 'paces',
    body: 'Threshold should be slower for masters athletes by default.',
  });
  await createFeedback(db, { body: 'Roster sort: put injuries first.' });

  let rows = await listFeedback(db);
  assert.equal(rows.length, 2);
  assert.equal(await countOpenFeedback(db), 2);
  const withContext = rows.find((r) => r.path === '/athletes/abc/plan')!;
  assert.equal(withContext.category, 'paces');
  assert.equal(withContext.author, 'Heather');

  await setFeedbackStatus(db, withContext.id, 'addressed');
  assert.equal(await countOpenFeedback(db), 1);
  rows = await listFeedback(db, ['open']);
  assert.ok(!rows.some((r) => r.id === withContext.id));
});

test('empty feedback body is rejected', async () => {
  await assert.rejects(() => createFeedback(db, { body: '   ' }));
});
