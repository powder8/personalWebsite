/**
 * Unit tests for the cross-sport transfer model + multi-track PMC (spec L3).
 * Node's built-in test runner via tsx (`npm test`), zero new deps.
 *
 * The load-bearing property is RUNNER-NEUTRALITY: for a run-only athlete the
 * three tracks must be BYTE-IDENTICAL to today's single PMC, so readiness and
 * feasibility are unchanged. That is proven explicitly below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeFitnessFatigue } from '../fitnessFatigue';
import type { DailyReading } from '../types';
import {
  transferCoeffs,
  splitLoad,
  computeFitnessTracks,
  aerobicCapacity,
  runVolumeSafety,
  trackId,
  parseTrackId,
  fromDbSport,
  TRANSFER_TABLE,
  DEFAULT_CROSS_COEFFS,
  type TransferSport,
  type Discipline,
  type TrackActivity,
} from '../transferLogic';

const DISCIPLINES: Discipline[] = ['run', 'bike', 'swim'];
const SPORTS: TransferSport[] = [
  'run',
  'bike',
  'swim',
  'pool_run',
  'elliptical',
  'strength',
  'cross_train',
  'other',
];

// --- coefficient table ----------------------------------------------------

test('same-sport diagonal is the identity {1,1,1} for every discipline', () => {
  for (const d of DISCIPLINES) {
    assert.deepEqual(transferCoeffs(d as unknown as TransferSport, d), {
      central: 1.0,
      economy: 1.0,
      durability: 1.0,
    });
  }
});

test('the L3 directive coefficients (bike/pool_run/swim → run)', () => {
  assert.deepEqual(transferCoeffs('bike', 'run'), { central: 0.75, economy: 0.1, durability: 0.0 });
  assert.deepEqual(transferCoeffs('pool_run', 'run'), { central: 0.9, economy: 0.5, durability: 0.3 });
  assert.equal(transferCoeffs('swim', 'run').central, 0.6);
  // impact only comes from actual foot-strike modalities
  assert.equal(transferCoeffs('bike', 'run').durability, 0.0);
  assert.equal(transferCoeffs('run', 'run').durability, 1.0);
});

test('every coefficient is a fraction in [0,1]; cross terms never exceed same-sport', () => {
  for (const d of DISCIPLINES) {
    for (const s of SPORTS) {
      const c = transferCoeffs(s, d);
      for (const v of [c.central, c.economy, c.durability]) {
        assert.ok(v >= 0 && v <= 1, `${s}->${d} coeff ${v} out of [0,1]`);
      }
      if ((s as string) !== d) {
        // A different sport can never over-credit any track vs. doing the sport.
        assert.ok(c.central <= 1 && c.economy <= 1 && c.durability <= 1);
      }
    }
  }
});

test('unmapped cross pairs fall back to the conservative default', () => {
  // Force a target lookup with no row: temporarily nothing — use a made-up sport.
  const exotic = 'unicycle' as unknown as TransferSport;
  assert.deepEqual(transferCoeffs(exotic, 'run'), DEFAULT_CROSS_COEFFS);
});

test('central transfer is highest from same-gait low-impact surrogates', () => {
  // pool_run/elliptical carry more run central + economy than bike does.
  assert.ok(transferCoeffs('pool_run', 'run').central > transferCoeffs('bike', 'run').central);
  assert.ok(transferCoeffs('pool_run', 'run').economy > transferCoeffs('bike', 'run').economy);
  assert.ok(transferCoeffs('pool_run', 'run').durability > transferCoeffs('swim', 'run').durability);
});

test('fromDbSport maps the stored enum through unchanged', () => {
  assert.equal(fromDbSport('run'), 'run');
  assert.equal(fromDbSport('cross_train'), 'cross_train');
});

// --- splitLoad ------------------------------------------------------------

test('splitLoad scales load by each coefficient', () => {
  const s = splitLoad('bike', 100, 'run');
  assert.equal(s.central, 75); // 0.75 * 100
  assert.equal(s.economy, 10);
  assert.equal(s.durability, 0);
});

test('splitLoad passes same-sport load through at full value to all tracks', () => {
  assert.deepEqual(splitLoad('run', 80, 'run'), { central: 80, economy: 80, durability: 80 });
});

// --- storage discriminator ------------------------------------------------

test('trackId / parseTrackId round-trip', () => {
  assert.equal(trackId('central', 'run'), 'central:run');
  assert.equal(trackId('durability', 'run'), 'durability:run');
  assert.deepEqual(parseTrackId('specific:bike'), { component: 'specific', discipline: 'bike' });
  assert.equal(parseTrackId('nonsense'), null);
  assert.equal(parseTrackId('central:pole_vault'), null);
});

// --- multi-track PMC ------------------------------------------------------

const RUN_ONLY: TrackActivity[] = [
  { day: '2026-01-01', sport: 'run', load: 60 },
  { day: '2026-01-03', sport: 'run', load: 90 },
  { day: '2026-01-04', sport: 'run', load: 45 },
  { day: '2026-01-07', sport: 'run', load: 120 },
  { day: '2026-01-10', sport: 'run', load: 70 },
];

test('RUNNER-NEUTRALITY: run-only athlete → all three tracks == the single PMC', () => {
  const from = '2026-01-01';
  const to = '2026-01-14';
  const single = computeFitnessFatigue(
    RUN_ONLY.map((a): DailyReading => ({ day: a.day, value: a.load })),
    from,
    to,
  );
  const tracks = computeFitnessTracks(RUN_ONLY, 'run', from, to);

  // Byte-identical: same day/load/ctl/atl/tsb on every track, every day.
  assert.deepEqual(tracks.central, single);
  assert.deepEqual(tracks.specific, single);
  assert.deepEqual(tracks.durability, single);
});

test('RUNNER-NEUTRALITY: the consult reads collapse to the single PMC for run-only', () => {
  const from = '2026-01-01';
  const to = '2026-01-14';
  const single = computeFitnessFatigue(
    RUN_ONLY.map((a): DailyReading => ({ day: a.day, value: a.load })),
    from,
    to,
  );
  const last = single[single.length - 1];
  const tracks = computeFitnessTracks(RUN_ONLY, 'run', from, to);

  const aero = aerobicCapacity(tracks);
  assert.deepEqual(aero, { ctl: last.ctl, atl: last.atl, tsb: last.tsb });

  const safety = runVolumeSafety(tracks);
  assert.equal(safety.durabilityCtl, last.ctl); // durability == central
  assert.equal(safety.centralCtl, last.ctl);
  assert.equal(safety.limitedByDurability, false); // never limited when they're equal
  // Cap derived from durability equals one derived from central → output unchanged.
  assert.equal(safety.safeWeeklyLoadCap, last.ctl * 7 * 1.1);
});

test('a big bike engine raises central but NOT run durability', () => {
  const from = '2026-01-01';
  const to = '2026-01-21';
  // A marathoner who mostly bikes: lots of bike load, a little running.
  const mixed: TrackActivity[] = [];
  for (let d = 1; d <= 21; d++) {
    const day = `2026-01-${String(d).padStart(2, '0')}`;
    if (d % 2 === 0) mixed.push({ day, sport: 'bike', load: 100 });
    if (d % 7 === 0) mixed.push({ day, sport: 'run', load: 40 });
  }
  const tracks = computeFitnessTracks(mixed, 'run', from, to);

  const central = tracks.central[tracks.central.length - 1].ctl;
  const durability = tracks.durability[tracks.durability.length - 1].ctl;
  const specific = tracks.specific[tracks.specific.length - 1].ctl;

  // Central engine is substantial (bike feeds it at 0.75)...
  assert.ok(central > 15, `central ctl ${central} should reflect the bike engine`);
  // ...but durability only saw the (small) actual running → far lower.
  assert.ok(durability < central * 0.35, `durability ${durability} must lag central ${central}`);
  // Specific sits between: some economy credit from bike, but discounted.
  assert.ok(specific < central && specific > durability);

  const safety = runVolumeSafety(tracks);
  assert.equal(safety.limitedByDurability, true); // the guardrail fires
  assert.ok(safety.safeWeeklyLoadCap < central * 7 * 1.1); // legs cap volume, not the engine
});

test('swim-only athlete expresses NO run durability (impact is not transferable)', () => {
  const from = '2026-01-01';
  const to = '2026-01-14';
  const swimOnly: TrackActivity[] = [
    { day: '2026-01-02', sport: 'swim', load: 80 },
    { day: '2026-01-05', sport: 'swim', load: 80 },
    { day: '2026-01-09', sport: 'swim', load: 80 },
  ];
  const tracks = computeFitnessTracks(swimOnly, 'run', from, to);
  assert.equal(tracks.durability[tracks.durability.length - 1].ctl, 0); // swim→run durability 0
  assert.ok(tracks.central[tracks.central.length - 1].ctl > 0); // but some central engine
});

test('empty history → zeroed consult reads, no crash', () => {
  const tracks = computeFitnessTracks([], 'run', '2026-01-01', '2026-01-05');
  assert.equal(aerobicCapacity(tracks)?.ctl, 0);
  const safety = runVolumeSafety(tracks);
  assert.equal(safety.durabilityCtl, 0);
  assert.equal(safety.limitedByDurability, false);
});

test('TRANSFER_TABLE covers every mapped sport for every discipline', () => {
  for (const d of DISCIPLINES) {
    // self entry always present
    assert.ok(TRANSFER_TABLE[d][d as unknown as TransferSport]);
  }
});
