import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { submitCheckIn, checkInSchema } from '../checkIn';
import { getRecoveryInsights, persistReadiness } from '../recovery';
import { setRecoveryAdjustment } from '../recoveryAdjustment';
import { listActiveDirectives, createDirective } from '../directives';
import { applyDirectives } from '@/engine/plan';

const client = new PGlite();
const db = drizzle(client, { schema });
const A = '99999999-9999-4999-8999-999999999991';
const B = '99999999-9999-4999-8999-999999999992';
const day = '2026-09-14';
before(async () => {
  for (const f of readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(`drizzle/${f}`, 'utf8').split('--> statement-breakpoint')) if (sql.trim()) await client.exec(sql);
  }
  await db.insert(schema.athletes).values([{ id: A, fullName: 'Recovery Test', email: 'recovery@example.com' }, { id: B, fullName: 'Other Test', email: 'other@example.com' }]);
});
after(() => client.close());

test('no wearable: check-in -> live assessment -> persisted coach view, partial updates preserve context', async () => {
  assert.equal((await getRecoveryInsights(db, A, day)).readiness, null);
  await submitCheckIn(db, A, { day, lifeStress: 9, sleepQuality: 2, note: 'Travel day' });
  await submitCheckIn(db, A, { day, energy: 2, soreness: 7 });
  const [saved] = await db.select().from(schema.checkIns).where(eq(schema.checkIns.athleteId, A));
  assert.equal(saved.lifeStress, 9);
  assert.equal(saved.note, 'Travel day');
  const result = await getRecoveryInsights(db, A, day);
  assert.equal(result.hasData, false);
  assert.equal(result.readiness?.band, 'easy');
  await persistReadiness(db, A, result.readiness!);
  const [persisted] = await db.select().from(schema.readinessAssessments).where(eq(schema.readinessAssessments.athleteId, A));
  assert.equal(persisted.band, 'easy');
  assert.equal(result.history.filter((d) => d.band != null).length, 1);
});

test('check-in validation rejects invalid dates, out-of-range and non-numeric answers', () => {
  for (const input of [{ day: '2026-02-30', energy: 2 }, { day, energy: 12 }, { day, energy: 'low' }, null]) {
    assert.equal(checkInSchema.safeParse(input).success, false);
  }
});

test('recovery choice is idempotent, expires, handles cycling, and undo preserves coach directives', async () => {
  const input = { day, mode: 'easy' as const, days: 3 as const };
  await setRecoveryAdjustment(db, A, input);
  await setRecoveryAdjustment(db, A, input);
  let dirs = await listActiveDirectives(db, A);
  assert.equal(dirs.length, 1);
  const bike = { day, sessionType: 'threshold', distanceMeters: null, durationSeconds: 3600, paceFastSecPerKm: null, paceSlowSecPerKm: null };
  let adj = applyDirectives(bike, dirs);
  assert.equal(adj.sessionType, 'easy'); assert.equal(adj.durationSeconds, 2520);
  assert.equal(applyDirectives({ ...bike, day: '2026-09-17' }, dirs).sessionType, 'threshold');
  await setRecoveryAdjustment(db, B, { ...input, mode: 'clear' });
  assert.equal((await listActiveDirectives(db, A)).length, 1);
  await setRecoveryAdjustment(db, A, { ...input, mode: 'rest' });
  dirs = await listActiveDirectives(db, A);
  adj = applyDirectives(bike, dirs);
  assert.equal(adj.sessionType, 'rest'); assert.equal(adj.durationSeconds, 0);
  await createDirective(db, A, { type: 'unavailable', from: day, to: null, label: 'Injury pause', source: 'coach' });
  await setRecoveryAdjustment(db, A, { ...input, mode: 'clear' });
  dirs = await listActiveDirectives(db, A);
  assert.equal(dirs.length, 1); assert.equal(dirs[0].label, 'Injury pause');
});
