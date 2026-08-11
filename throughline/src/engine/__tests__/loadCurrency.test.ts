/**
 * Unit tests for the load-currency kernel (spec story L0). Zero new deps:
 * Node's built-in test runner via tsx. Run with `npm test`.
 *
 * Every rung is checked against the anchoring identity — 1 hour at threshold =
 * 100 — and against the worked examples in the spec (§1.2, §2.3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { banisterTrimp } from '../load';
import type { HrParams } from '../types';
import {
  loadFromIntensity,
  normalizedPower,
  tssFromPower,
  rtss,
  stss,
  hrTss,
  thresholdHourTrimp,
  estimatedTss,
  estimateLoadTss,
  zoneIf,
  THRESHOLD_HOUR_LOAD,
  DEFAULT_ESTIMATED_IF,
  MAX_RUN_IF,
  MAX_SWIM_IF,
  type LoadCurrencyResult,
} from '../loadCurrencyLogic';

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);

// --- the shared kernel ---------------------------------------------------

test('kernel: 1 h at threshold (IF 1) = 100', () => {
  approx(loadFromIntensity(1, 1), 100);
  assert.equal(THRESHOLD_HOUR_LOAD, 100);
});

test('kernel: spec §1.2 worked examples', () => {
  // 2 h ride @ IF 0.75 → 0.75² × 2 × 100 = 112.5
  approx(loadFromIntensity(0.75, 2), 112.5);
  // 45 min threshold run → 1² × 0.75 × 100 = 75
  approx(loadFromIntensity(1, 0.75), 75);
  // and they sum onto one PMC: 187.5 "threshold-hours" of stress
  approx(loadFromIntensity(0.75, 2) + loadFromIntensity(1, 0.75), 187.5);
});

test('kernel: intensity costs more than volume (IF² weighting)', () => {
  // Double the intensity at half the duration is NOT equal load.
  assert.ok(loadFromIntensity(1.0, 1) > loadFromIntensity(0.5, 2));
});

test('kernel: zero/negative inputs → 0', () => {
  assert.equal(loadFromIntensity(0, 5), 0);
  assert.equal(loadFromIntensity(1, 0), 0);
  assert.equal(loadFromIntensity(-1, 1), 0);
});

// --- Normalized Power ----------------------------------------------------

test('normalizedPower: constant stream returns the constant', () => {
  approx(normalizedPower(new Array(120).fill(200), 1), 200, 1e-9);
});

test('normalizedPower: variable stream exceeds the simple mean', () => {
  // 30 min @ 100 W then 30 min @ 300 W: mean 200, but NP is pulled up by the 4th power.
  const stream = [...new Array(1800).fill(100), ...new Array(1800).fill(300)];
  const np = normalizedPower(stream, 1);
  const mean = stream.reduce((a, b) => a + b, 0) / stream.length;
  assert.ok(np > mean, `NP ${np.toFixed(1)} > mean ${mean}`);
  assert.ok(np > 240 && np < 270, `NP ${np.toFixed(1)} in the expected quartic range`);
});

test('normalizedPower: stream shorter than one window → simple mean', () => {
  approx(normalizedPower([100, 200, 300], 1), 200);
  assert.equal(normalizedPower([], 1), 0);
});

// --- (a) power TSS -------------------------------------------------------

test('tssFromPower: 1 h at FTP = 100 TSS, IF 1, power confidence', () => {
  const r = tssFromPower({ ftpWatts: 250, durationSeconds: 3600, powerSamples: new Array(120).fill(250) });
  approx(r.load, 100, 1e-6);
  approx(r.intensityFactor, 1, 1e-9);
  assert.equal(r.confidence, 'power');
  assert.equal(r.lowConfidence, false);
});

test('tssFromPower: accepts a pre-computed NP; sub-threshold ride < 100/h', () => {
  const r = tssFromPower({ ftpWatts: 250, durationSeconds: 7200, normalizedPowerWatts: 187.5 });
  // IF = 187.5/250 = 0.75 → 0.75² × 2 × 100 = 112.5
  approx(r.load, 112.5, 1e-9);
  approx(r.intensityFactor, 0.75, 1e-9);
});

// --- (b) running rTSS ----------------------------------------------------

test('rtss: an hour at threshold pace = 100/h', () => {
  const r = rtss({ thresholdPaceSecPerKm: 240, durationSeconds: 3600, avgPaceSecPerKm: 240 });
  approx(r.load, 100, 1e-9);
  approx(r.intensityFactor, 1, 1e-9);
  assert.equal(r.confidence, 'pace');
});

test('rtss: faster than threshold → higher IF; NGP preferred over raw pace', () => {
  const r = rtss({ thresholdPaceSecPerKm: 240, durationSeconds: 1800, ngpSecPerKm: 220, avgPaceSecPerKm: 260 });
  // uses NGP 220: IF = 240/220 ≈ 1.0909
  approx(r.intensityFactor, 240 / 220, 1e-9);
  assert.ok(r.load > 50); // half hour but faster than threshold
});

test('rtss: short-rep IF is clamped to the ceiling', () => {
  const r = rtss({ thresholdPaceSecPerKm: 240, durationSeconds: 300, avgPaceSecPerKm: 150 });
  approx(r.intensityFactor, MAX_RUN_IF, 1e-9);
});

// --- (c) swimming sTSS ---------------------------------------------------

test('stss: an hour at CSS = 100/h', () => {
  const r = stss({ cssMetersPerSec: 1.4, durationSeconds: 3600, swimSpeedMetersPerSec: 1.4 });
  approx(r.load, 100, 1e-9);
  approx(r.intensityFactor, 1, 1e-9);
  assert.equal(r.confidence, 'css');
});

test('stss: derives speed from distance+duration and clamps IF', () => {
  const r = stss({ cssMetersPerSec: 1.0, durationSeconds: 600, distanceMeters: 900 }); // 1.5 m/s > CSS
  approx(r.intensityFactor, MAX_SWIM_IF, 1e-9);
});

// --- (d) hrTSS + the conversion constant ---------------------------------

const HR: HrParams = { restingHr: 50, maxHr: 190, sex: 'M' };

test('thresholdHourTrimp: matches Banister at the threshold HR (spec §2.3 ≈177 for men)', () => {
  const lthr = 50 + 0.87 * (190 - 50); // 171.8
  approx(thresholdHourTrimp(HR, lthr), banisterTrimp(3600, lthr, HR), 1e-9);
  // Default (no LTHR) synthesizes the same threshold HR → same constant.
  approx(thresholdHourTrimp(HR), banisterTrimp(3600, lthr, HR), 1e-9);
  // Sanity: a men's threshold hour is ~150–180 TRIMP.
  const c = thresholdHourTrimp(HR);
  assert.ok(c > 150 && c < 185, `threshold-hour TRIMP ${c.toFixed(1)}`);
});

test('hrTss: a threshold-HR hour rescales to ~100 by construction', () => {
  const lthr = 50 + 0.87 * (190 - 50);
  const r = hrTss({ durationSeconds: 3600, avgHr: lthr, hr: HR, lthrBpm: lthr });
  approx(r.load, 100, 1e-9);
  approx(r.intensityFactor, 1, 1e-9);
  assert.equal(r.confidence, 'hr');
});

test('hrTss: an easy-HR hour is well under 100', () => {
  const r = hrTss({ durationSeconds: 3600, avgHr: 120, hr: HR }); // ~50% HRR
  assert.ok(r.load > 0 && r.load < 70, `easy hrTSS ${r.load.toFixed(1)}`);
});

// --- (e) estimated TSS ---------------------------------------------------

test('estimatedTss: endurance default ≈ the legacy volume proxy (42/h)', () => {
  const r = estimatedTss({ durationSeconds: 3600 });
  // 0.65² × 100 = 42.25/h, vs old durMin × 0.7 = 42/h
  approx(r.load, DEFAULT_ESTIMATED_IF ** 2 * 100, 1e-9);
  assert.ok(Math.abs(r.load - 42) < 1, `estimated ${r.load} ≈ 42 legacy`);
  assert.equal(r.confidence, 'estimated');
  assert.equal(r.lowConfidence, true);
});

test('estimatedTss: zone IF and explicit assumed IF', () => {
  approx(estimatedTss({ durationSeconds: 3600, zone: 'threshold' }).load, 0.98 ** 2 * 100, 1e-9);
  approx(estimatedTss({ durationSeconds: 3600, assumedIf: 1.0 }).load, 100, 1e-9);
  assert.equal(zoneIf('VO2max'), 1.05);
  assert.equal(zoneIf('unknown-zone'), DEFAULT_ESTIMATED_IF);
});

// --- dispatch: same shape, right rung ------------------------------------

const anchors = {
  ftpWatts: 250,
  thresholdPaceSecPerKm: 240,
  cssMetersPerSec: 1.4,
  hr: HR,
  lthrBpm: 50 + 0.87 * (190 - 50),
};

function assertShape(r: LoadCurrencyResult) {
  for (const k of ['load', 'intensityFactor', 'durationHours', 'confidence', 'lowConfidence'] as const) {
    assert.ok(k in r, `result has ${k}`);
  }
}

test('estimateLoadTss: bike with power → power tier', () => {
  const r = estimateLoadTss(
    { sport: 'bike', durationSeconds: 3600, normalizedPowerWatts: 250 },
    anchors,
  );
  assert.equal(r.confidence, 'power');
  approx(r.load, 100, 1e-6);
  assertShape(r);
});

test('estimateLoadTss: bike without power but with HR → hr tier', () => {
  const r = estimateLoadTss({ sport: 'bike', durationSeconds: 3600, avgHr: 150 }, anchors);
  assert.equal(r.confidence, 'hr');
});

test('estimateLoadTss: run with pace → pace tier; without pace but HR → hr tier', () => {
  assert.equal(
    estimateLoadTss({ sport: 'run', durationSeconds: 3600, avgPaceSecPerKm: 240 }, anchors).confidence,
    'pace',
  );
  assert.equal(
    estimateLoadTss({ sport: 'run', durationSeconds: 3600, avgHr: 150 }, anchors).confidence,
    'hr',
  );
});

test('estimateLoadTss: swim with CSS → css tier; swim HR is ignored', () => {
  assert.equal(
    estimateLoadTss({ sport: 'swim', durationSeconds: 3600, distanceMeters: 5040 }, anchors).confidence,
    'css',
  );
  // Even with HR present, no CSS speed → estimated (swim HR unreliable).
  assert.equal(
    estimateLoadTss({ sport: 'swim', durationSeconds: 3600, avgHr: 150 }, anchors).confidence,
    'estimated',
  );
});

test('estimateLoadTss: strength/other → estimated, always lowConfidence', () => {
  const noHr = estimateLoadTss({ sport: 'strength', durationSeconds: 3600 }, anchors);
  assert.equal(noHr.confidence, 'estimated');
  assert.equal(noHr.lowConfidence, true);
  // Even with HR, cross-training stays flagged soft.
  const withHr = estimateLoadTss({ sport: 'cross_train', durationSeconds: 3600, avgHr: 150 }, anchors);
  assert.equal(withHr.lowConfidence, true);
});

test('estimateLoadTss: no anchors → falls to estimated fallback', () => {
  const r = estimateLoadTss({ sport: 'run', durationSeconds: 3600, avgPaceSecPerKm: 240 }, {});
  assert.equal(r.confidence, 'estimated');
});

test('estimateLoadTss: zero duration → zero load', () => {
  assert.equal(estimateLoadTss({ sport: 'run', durationSeconds: 0 }, anchors).load, 0);
});
