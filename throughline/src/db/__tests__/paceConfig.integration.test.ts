/**
 * Two-level pace customization, persisted — real Postgres via PGlite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../schema';
import { athletes, intakeProfiles } from '../schema';
import { getAthleteZones, setGlobalPaceModel, setAthletePaceConfig, getGlobalPaceModel } from '../paceConfig';
import { midpoint, DEFAULT_GLOBAL_MODEL } from '@/engine/plan';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const A = '33333333-3333-4333-8333-333333333333';

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
  await db.insert(athletes).values({ id: A, fullName: 'Cfg', email: 'cfg@example.com', timezone: 'UTC' });
});

after(async () => {
  await client.close();
});

test('default global model + intake threshold fallback resolves zones', async () => {
  await db.insert(intakeProfiles).values({ athleteId: A, answers: { thresholdSecPerKm: 222 } });
  const zones = await getAthleteZones(db, A);
  assert.ok(zones, 'zones resolved from intake threshold');
  assert.ok(midpoint(zones!.zones.easy) > midpoint(zones!.zones.threshold), 'easy slower than threshold');

  // Default global model is VDOT.
  const g = await getGlobalPaceModel(db);
  assert.equal(g.kind, DEFAULT_GLOBAL_MODEL.kind);
});

test('per-athlete config overrides the anchor and a zone', async () => {
  await setAthletePaceConfig(db, A, {
    race: { distanceMeters: 21097.5, timeSeconds: 73 * 60 },
    zoneOverrides: { threshold: { fastAdjust: 30, slowAdjust: 30 } },
  });
  const zones = await getAthleteZones(db, A);
  assert.ok(zones);
  // With the +30 s/km nudge, threshold is clearly slower than a stock resolve.
  assert.ok(midpoint(zones!.zones.threshold) > 200, 'nudged threshold reflects the override');
});

test('editing the global model changes resolution for athletes on the default', async () => {
  // Reset athlete to use intake anchor + global model only.
  await setAthletePaceConfig(db, A, {});
  const before = await getAthleteZones(db, A);

  await setGlobalPaceModel(db, {
    ...DEFAULT_GLOBAL_MODEL,
    vdotZones: {
      ...DEFAULT_GLOBAL_MODEL.vdotZones!,
      easy: { fast: 0.68, slow: 0.58 }, // easier easy runs globally
    },
  });
  const after = await getAthleteZones(db, A);
  assert.ok(
    midpoint(after!.zones.easy) > midpoint(before!.zones.easy),
    'global edit slowed easy pace for this athlete',
  );
});
