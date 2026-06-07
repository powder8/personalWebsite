/**
 * Import persistence integration test — real Postgres via PGlite. Uses synthetic
 * parsed days (no file) so it's portable, and asserts append-only RawEvent +
 * normalized Activity behavior, including idempotent re-import.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

import * as schema from '../schema';
import { rawEvents, activities, athletes } from '../schema';
import { importParsedDays } from '../import';
import type { ParsedDay } from '@/providers/manual/parseTrainingLog';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const athleteId = '22222222-2222-4222-8222-222222222222';

function day(date: string, over: Partial<ParsedDay>): ParsedDay {
  return {
    date,
    dayName: 'Monday',
    sheetName: 'Test',
    sport: 'run',
    assignedMiles: null,
    actualMiles: null,
    workout: '',
    warmup: '',
    cooldown: '',
    description: '',
    core: '',
    avgPaceSecPerKm: null,
    durationSeconds: null,
    ...over,
  };
}

const DAYS: ParsedDay[] = [
  day('2026-01-05', {
    actualMiles: 8,
    avgPaceSecPerKm: 270,
    durationSeconds: 8 * 1609.344 * (270 / 1000) | 0,
    assignedMiles: { value: 7.5, lo: 7, hi: 8, wasDateBug: true }, // reversed "7-8"
    description: '7:14 avg',
  }),
  day('2026-01-06', { actualMiles: 10, workout: '9 miles at maintenance' }),
  day('2026-01-07', { actualMiles: null, workout: 'Rest day' }), // no activity, but still an event
];

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  const sql = readFileSync(join(process.cwd(), 'drizzle', '0000_init.sql'), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const t = stmt.trim();
    if (t) await client.exec(t);
  }
  await db.insert(athletes).values({
    id: athleteId,
    fullName: 'Import Test',
    email: 'import-test@example.com',
    timezone: 'UTC',
  });
});

after(async () => {
  await client.close();
});

test('import writes append-only RawEvents (provider=manual) and normalized Activities', async () => {
  const res = await importParsedDays(db, athleteId, DAYS, { fileName: 'test.xlsx' });
  assert.equal(res.days, 3);
  assert.equal(res.rawEvents, 3); // every day → a RawEvent (incl. the rest day)
  assert.equal(res.activities, 2); // only days with actualMiles > 0
  assert.equal(res.dateBugFixes, 1);
  assert.equal(res.pacesParsed, 1);

  const raws = await db.select().from(rawEvents).where(eq(rawEvents.athleteId, athleteId));
  assert.equal(raws.length, 3);
  assert.ok(raws.every((r) => r.provider === 'manual' && r.source === 'file_upload'));

  const acts = await db.select().from(activities).where(eq(activities.athleteId, athleteId));
  assert.equal(acts.length, 2);
  const eight = acts.find((a) => Math.round((a.distanceMeters ?? 0) / 1609.344) === 8)!;
  assert.ok(eight.avgPaceSecPerKm === 270 && eight.durationSeconds != null);
});

test('re-import is idempotent — no duplicate events or activities', async () => {
  const res = await importParsedDays(db, athleteId, DAYS, { fileName: 'test.xlsx' });
  assert.equal(res.rawEvents, 0, 'no new RawEvents on identical re-import');

  const raws = await db.select().from(rawEvents).where(eq(rawEvents.athleteId, athleteId));
  const acts = await db.select().from(activities).where(eq(activities.athleteId, athleteId));
  assert.equal(raws.length, 3, 'RawEvent count unchanged');
  assert.equal(acts.length, 2, 'Activity count unchanged (upsert by sourceRef)');
});
