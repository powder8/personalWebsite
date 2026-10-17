import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/db/schema';
import { rateLimitEvents } from '@/db/schema';
import { consumeRateLimit } from '../rateLimit';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readdirSync(join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf8')).join('\n--> statement-breakpoint\n');
  for (const s of sql.split('--> statement-breakpoint')) { const t = s.trim(); if (t) await client.exec(t); }
});
after(async () => { await client.close(); });

const HOUR = 3600_000;
const t0 = new Date('2026-10-17T10:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

test('allows up to max per window, then refuses with a retry hint', async () => {
  const w = [{ max: 3, windowMs: HOUR }];
  for (let i = 0; i < 3; i++) assert.equal((await consumeRateLimit(db, 'k1', w, at(i))).ok, true);
  const r = await consumeRateLimit(db, 'k1', w, at(10));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.retryAfterSec, 50 * 60, 'the oldest call ages out at +60 min');
});

test('the window slides: old calls stop counting', async () => {
  const w = [{ max: 3, windowMs: HOUR }];
  assert.equal((await consumeRateLimit(db, 'k1', w, at(61))).ok, true);
});

test('keys are independent; the daily window still binds', async () => {
  assert.equal((await consumeRateLimit(db, 'k2', [{ max: 3, windowMs: HOUR }], at(0))).ok, true);
  const w = [{ max: 100, windowMs: HOUR }, { max: 2, windowMs: 24 * HOUR }];
  assert.equal((await consumeRateLimit(db, 'k3', w, at(0))).ok, true);
  assert.equal((await consumeRateLimit(db, 'k3', w, at(120))).ok, true);
  assert.equal((await consumeRateLimit(db, 'k3', w, at(240))).ok, false);
});

test('refused calls are not recorded, and old rows are pruned', async () => {
  await consumeRateLimit(db, 'k4', [{ max: 1, windowMs: HOUR }], at(0));
  await consumeRateLimit(db, 'k4', [{ max: 1, windowMs: HOUR }], at(1)); // refused
  await consumeRateLimit(db, 'k4', [{ max: 1, windowMs: HOUR }], at(200)); // prunes the at(0) row
  const rows = (await db.select().from(rateLimitEvents)).filter((r) => r.key === 'k4');
  assert.equal(rows.length, 1);
});
