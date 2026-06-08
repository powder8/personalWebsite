/**
 * Shoe mileage tracking — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { athletes, activities } from '@/db/schema';
import {
  addShoe,
  setDefaultShoe,
  getDefaultShoeId,
  listShoesWithMileage,
  assignActivityShoe,
  retireShoe,
} from '../shoes';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '77777777-7777-4777-8777-777777777777';

async function addRun(meters: number, shoeId: string | null, iso: string) {
  await db.insert(activities).values({
    athleteId: A,
    sport: 'run',
    provider: 'strava',
    startTime: new Date(iso),
    distanceMeters: meters,
    shoeId,
    sourceRef: `strava:${iso}-${Math.round(meters)}`,
  });
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
  await db.insert(athletes).values({ id: A, fullName: 'Shoe Tester', email: 'shoe@x.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

test('first shoe marked default becomes the auto-assign target', async () => {
  const daily = await addShoe(db, A, { name: 'Daily Trainer', isDefault: true, maxMiles: 400 });
  assert.equal(await getDefaultShoeId(db, A), daily);
});

test('mileage = initialMiles + assigned-run miles', async () => {
  const [daily] = (await listShoesWithMileage(db, A)).filter((s) => s.name === 'Daily Trainer');
  await addRun(10000, daily.id, '2026-06-01T12:00:00Z'); // ~6.21 mi
  await addRun(5000, daily.id, '2026-06-02T12:00:00Z'); // ~3.11 mi
  await addRun(8000, null, '2026-06-03T12:00:00Z'); // unassigned → not counted
  const after = (await listShoesWithMileage(db, A)).find((s) => s.id === daily.id)!;
  assert.ok(Math.abs(after.miles - 9.3) < 0.2, `miles ${after.miles}`);
  assert.equal(after.runs, 2);
});

test('setDefaultShoe moves the default to exactly one pair', async () => {
  const racer = await addShoe(db, A, { name: 'Racer', maxMiles: 200 });
  await setDefaultShoe(db, A, racer);
  assert.equal(await getDefaultShoeId(db, A), racer);
  const shoes = await listShoesWithMileage(db, A);
  assert.equal(shoes.filter((s) => s.isDefault).length, 1);
});

test('reassigning an activity moves its miles between pairs', async () => {
  const shoes = await listShoesWithMileage(db, A);
  const daily = shoes.find((s) => s.name === 'Daily Trainer')!;
  const racer = shoes.find((s) => s.name === 'Racer')!;
  const [run] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.shoeId, daily.id))
    .limit(1);
  await assignActivityShoe(db, A, run.id, racer.id);
  const after = await listShoesWithMileage(db, A);
  assert.ok(after.find((s) => s.id === racer.id)!.miles > 0, 'racer now has miles');
});

test('retiring a pair clears default and marks it retired', async () => {
  const racer = (await listShoesWithMileage(db, A)).find((s) => s.name === 'Racer')!;
  await retireShoe(db, A, racer.id, '2026-06-10');
  const after = (await listShoesWithMileage(db, A)).find((s) => s.id === racer.id)!;
  assert.ok(after.retiredAt && !after.isDefault);
  assert.notEqual(await getDefaultShoeId(db, A), racer.id);
});
