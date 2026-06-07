import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  vdotFromRace,
  paceForVdotFraction,
  buildZonesFromVdot,
  resolvePaceZones,
  vdotFromThreshold,
  buildZones,
  estimateThresholdSecPerKm,
  midpoint,
  predictRaceTimeSeconds,
  equivalentPerformances,
  DEFAULT_GLOBAL_MODEL,
  type ZoneKey,
} from '../index';

const MOIRA = { distanceMeters: 21097.5, timeSeconds: 73 * 60 }; // 1:13 half

test('vdotFromRace: faster runners score higher; elite half ≈ mid-60s VDOT', () => {
  const fast = vdotFromRace({ distanceMeters: 10000, timeSeconds: 35 * 60 });
  const slow = vdotFromRace({ distanceMeters: 10000, timeSeconds: 52 * 60 });
  assert.ok(fast > slow);
  const moira = vdotFromRace(MOIRA);
  assert.ok(moira > 58 && moira < 72, `got VDOT ${moira}`);
});

test('paceForVdotFraction: higher %VDOT → faster pace', () => {
  const v = 60;
  assert.ok(paceForVdotFraction(v, 1.0) < paceForVdotFraction(v, 0.7));
});

test('VDOT zones are ordered fast→slow across intensities', () => {
  const z = buildZonesFromVdot(vdotFromRace(MOIRA));
  const order: ZoneKey[] = ['rep', 'interval', 'threshold', 'marathon', 'maintenance', 'easy', 'recovery'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(midpoint(z.zones[order[i]]) > midpoint(z.zones[order[i - 1]]));
  }
});

test('VDOT and threshold-offset models agree on threshold within ~15 s/km for the same athlete', () => {
  const vdotZones = buildZonesFromVdot(vdotFromRace(MOIRA));
  const offsetZones = buildZones(estimateThresholdSecPerKm(MOIRA));
  const diff = Math.abs(midpoint(vdotZones.zones.threshold) - midpoint(offsetZones.zones.threshold));
  assert.ok(diff < 15, `threshold paces should be close; diff ${diff.toFixed(1)} s/km`);
});

test('vdotFromThreshold is a sane inverse (round-trips near the source VDOT)', () => {
  const vdot = vdotFromRace(MOIRA);
  const thr = paceForVdotFraction(vdot, 0.87); // ~threshold pace
  const back = vdotFromThreshold(thr);
  assert.ok(Math.abs(back - vdot) < 4, `round-trip ${back} vs ${vdot}`);
});

// --- two-level resolution ---

test('resolve: global VDOT default + per-athlete race anchor', () => {
  const elite = resolvePaceZones({ race: MOIRA });
  const rec = resolvePaceZones({ race: { distanceMeters: 10000, timeSeconds: 52 * 60 } });
  // Recreational easy pace is much slower than elite easy pace.
  assert.ok(midpoint(rec.zones.easy) > midpoint(elite.zones.easy) + 100);
});

test('individual zone override nudges only that zone', () => {
  const base = resolvePaceZones({ race: MOIRA });
  const tweaked = resolvePaceZones({
    race: MOIRA,
    zoneOverrides: { threshold: { slowAdjust: 25, fastAdjust: 25 } }, // run tempos 25 s/km easier
  });
  assert.ok(midpoint(tweaked.zones.threshold) > midpoint(base.zones.threshold) + 20);
  // other zones unchanged
  assert.equal(midpoint(tweaked.zones.easy), midpoint(base.zones.easy));
});

test('individual can switch model kind to threshold-offset', () => {
  const vdot = resolvePaceZones({ kind: 'vdot', race: MOIRA });
  const offset = resolvePaceZones({ kind: 'threshold_offset', race: MOIRA });
  // Both produce a full set of zones; maintenance exists in both.
  assert.ok(midpoint(vdot.zones.maintenance) > 0 && midpoint(offset.zones.maintenance) > 0);
});

test('equivalent race times: longer distance = more time; self-consistent with VDOT', () => {
  const vdot = vdotFromRace(MOIRA); // ~65
  const perfs = equivalentPerformances(vdot);
  for (let i = 1; i < perfs.length; i++) {
    assert.ok(perfs[i].timeSeconds > perfs[i - 1].timeSeconds, 'longer distance takes longer');
  }
  // Feeding a predicted time back through vdotFromRace recovers ~the same VDOT.
  const tenK = perfs.find((p) => p.label === '10K')!;
  const back = vdotFromRace({ distanceMeters: 10000, timeSeconds: tenK.timeSeconds });
  assert.ok(Math.abs(back - vdot) < 1.0, `round-trip VDOT ${back} vs ${vdot}`);
});

test('a faster runner has faster equivalent times at every distance', () => {
  const fast = equivalentPerformances(65);
  const slow = equivalentPerformances(45);
  for (let i = 0; i < fast.length; i++) assert.ok(fast[i].timeSeconds < slow[i].timeSeconds);
  // sanity: VDOT 50 → 5K in a plausible ~19–20 min window.
  const fiveK = equivalentPerformances(50).find((p) => p.label === '5K')!;
  assert.ok(fiveK.timeSeconds > 18 * 60 && fiveK.timeSeconds < 21 * 60, `5K ${fiveK.timeSeconds}s`);
});

test('strength bias tilts reps and marathon in opposite directions', () => {
  const balanced = resolvePaceZones({ race: MOIRA, strengthBias: 0 });
  const speed = resolvePaceZones({ race: MOIRA, strengthBias: 0.6 });
  const endurance = resolvePaceZones({ race: MOIRA, strengthBias: -0.6 });

  // Speed type: faster reps (smaller s/km), slower marathon (larger s/km).
  assert.ok(midpoint(speed.zones.rep) < midpoint(balanced.zones.rep));
  assert.ok(midpoint(speed.zones.marathon) > midpoint(balanced.zones.marathon));
  // Endurance type: the opposite.
  assert.ok(midpoint(endurance.zones.rep) > midpoint(balanced.zones.rep));
  assert.ok(midpoint(endurance.zones.marathon) < midpoint(balanced.zones.marathon));
  // Easy pace is essentially untouched by strength bias.
  assert.equal(midpoint(speed.zones.easy), midpoint(balanced.zones.easy));
});

test('overall-model band edit shifts everyone using the default anchor', () => {
  const stockGlobal = DEFAULT_GLOBAL_MODEL;
  const easierThreshold = {
    ...DEFAULT_GLOBAL_MODEL,
    vdotZones: {
      ...DEFAULT_GLOBAL_MODEL.vdotZones!,
      threshold: { fast: 0.8, slow: 0.78 }, // lower %VDOT → slower threshold for ALL athletes
    },
  };
  const a = resolvePaceZones({ race: MOIRA }, stockGlobal);
  const b = resolvePaceZones({ race: MOIRA }, easierThreshold);
  assert.ok(
    midpoint(b.zones.threshold) > midpoint(a.zones.threshold) + 8,
    `global edit should slow threshold; a=${midpoint(a.zones.threshold).toFixed(1)} b=${midpoint(b.zones.threshold).toFixed(1)}`,
  );
});
