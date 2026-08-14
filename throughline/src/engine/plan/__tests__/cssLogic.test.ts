import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cssFrom400_200,
  cssFromTwoDistance,
  cssFromVelocityCurve,
  cssFromTimeTrial,
  ttFactorForDuration,
  cssFromTest,
  resolveCss,
  resolveSwimZones,
  DEFAULT_GLOBAL_SWIM_MODEL,
  type SwimTest,
  type GlobalSwimModel,
} from '../index';

// --- canonical 400/200 (the Wakayoshi anchor) --------------------------------

test('cssFrom400_200: (400-200)/(t400-t200), the Wakayoshi/Ginn anchor', () => {
  // 400 in 6:00 (360 s), 200 in 2:50 (170 s) → 200 / 190 ≈ 1.053 m/s.
  // (CSS is rounded to thousandths of m/s, the FTP-integer-rounding analog.)
  const css = cssFrom400_200(360, 170)!;
  assert.ok(Math.abs(css - 200 / 190) < 1e-3);
  // A faster swimmer: 400 in 5:00 (300), 200 in 2:20 (140) → 200/160 = 1.25 m/s.
  assert.equal(cssFrom400_200(300, 140), 1.25);
});

test('cssFrom400_200: null when t400 does not exceed t200 (degenerate)', () => {
  assert.equal(cssFrom400_200(200, 200), null);
  assert.equal(cssFrom400_200(150, 200), null);
});

// --- generic two-distance ----------------------------------------------------

test('cssFromTwoDistance: (dL-dS)/(tL-tS) matches 400/200 as a special case', () => {
  assert.equal(cssFromTwoDistance(400, 300, 200, 140), cssFrom400_200(300, 140));
  // Swim Smooth 400/50 variant: 400 in 300 s, 50 in 32 s → 350 / 268 ≈ 1.306.
  const css = cssFromTwoDistance(400, 300, 50, 32)!;
  assert.ok(Math.abs(css - 350 / 268) < 1e-3);
});

test('cssFromTwoDistance: null when the long swim is not farther-and-slower', () => {
  assert.equal(cssFromTwoDistance(200, 300, 400, 140), null); // shorter distance
  assert.equal(cssFromTwoDistance(400, 140, 200, 300), null); // faster elapsed
});

// --- velocity-curve least-squares fit ----------------------------------------

test('cssFromVelocityCurve: recovers CV from a synthetic D = CV·T + d0 line', () => {
  const CV = 1.2; // m/s
  const D0 = 8; // metres of "anaerobic distance capacity" offset
  const curve = [50, 100, 200, 400].map((d) => ({
    distanceMeters: d,
    timeSec: (d - D0) / CV,
  }));
  const css = cssFromVelocityCurve(curve)!;
  assert.ok(Math.abs(css - CV) < 1e-3, `CV ~${CV}, got ${css}`);
});

test('cssFromVelocityCurve: null when under-determined (<2 distinct distances)', () => {
  assert.equal(cssFromVelocityCurve([{ distanceMeters: 200, timeSec: 150 }]), null);
  assert.equal(
    cssFromVelocityCurve([
      { distanceMeters: 200, timeSec: 150 },
      { distanceMeters: 200, timeSec: 152 },
    ]),
    null,
  );
});

// --- single time trial (duration-discounted) ---------------------------------

test('ttFactorForDuration: picks the bucket covering the TT time', () => {
  assert.equal(ttFactorForDuration(60), 1.12); // ~50–100 m sprint
  assert.equal(ttFactorForDuration(150), 1.06); // ~200 m
  assert.equal(ttFactorForDuration(360), 1.0); // ~400 m ≈ CSS
  assert.equal(ttFactorForDuration(1300), 0.97); // 1500 m+, below CSS
});

test('cssFromTimeTrial: short TT discounts DOWN toward CSS, long TT bumps UP', () => {
  // 100 m in 80 s = 1.25 m/s, factor 1.12 → CSS = 1.25/1.12 ≈ 1.116 (below TT speed).
  const shortCss = cssFromTimeTrial(100, 80)!;
  assert.ok(shortCss < 100 / 80);
  assert.ok(Math.abs(shortCss - 1.25 / 1.12) < 1e-3);
  // 1500 m in 1300 s ≈ 1.154 m/s, factor 0.97 → CSS ≈ 1.190 (above TT speed).
  const longCss = cssFromTimeTrial(1500, 1300)!;
  assert.ok(longCss > 1500 / 1300);
  // 400 m TT ≈ CSS (factor 1.0): CSS equals TT speed.
  assert.equal(cssFromTimeTrial(400, 360), Math.round((400 / 360) * 1000) / 1000);
});

test('cssFromTimeTrial: null on non-positive distance/time', () => {
  assert.equal(cssFromTimeTrial(0, 80), null);
  assert.equal(cssFromTimeTrial(100, 0), null);
});

// --- dispatch ----------------------------------------------------------------

test('cssFromTest dispatches each kind to the right estimator', () => {
  assert.equal(
    cssFromTest({ kind: 'css_400_200', t400Sec: 300, t200Sec: 140 }),
    cssFrom400_200(300, 140),
  );
  assert.equal(
    cssFromTest({ kind: 'css_two_distance', dLongMeters: 400, tLongSec: 300, dShortMeters: 50, tShortSec: 32 }),
    cssFromTwoDistance(400, 300, 50, 32),
  );
  assert.equal(
    cssFromTest({ kind: 'time_trial', ttDistanceMeters: 400, ttTimeSec: 360 }),
    cssFromTimeTrial(400, 360),
  );
  const curve = [
    { distanceMeters: 100, timeSec: 80 },
    { distanceMeters: 400, timeSec: 330 },
  ];
  assert.equal(cssFromTest({ kind: 'velocity_curve', curve }), cssFromVelocityCurve(curve));
});

test('cssFromTest: null when the chosen kind is missing its inputs', () => {
  assert.equal(cssFromTest({ kind: 'css_400_200' }), null);
  assert.equal(cssFromTest({ kind: 'time_trial', ttDistanceMeters: 400 }), null);
});

test('cssFromTest: global ttFactor overrides tune the single-TT discount', () => {
  const custom: GlobalSwimModel = {
    ...DEFAULT_GLOBAL_SWIM_MODEL,
    ttFactorByDurationSec: [{ maxDurationSec: Number.POSITIVE_INFINITY, factor: 1.0 }],
  };
  // With factor 1.0 everywhere, CSS is just the raw TT speed.
  assert.equal(
    cssFromTest({ kind: 'time_trial', ttDistanceMeters: 100, ttTimeSec: 80 }, custom),
    Math.round((100 / 80) * 1000) / 1000,
  );
});

// --- resolveCss precedence (the resolveFtp / getAthleteVdot twin) -------------

test('resolveCss: explicit CSS wins over a test', () => {
  assert.equal(resolveCss({ cssMetersPerSec: 1.3, swimTest: { kind: 'css_400_200', t400Sec: 300, t200Sec: 140 } }), 1.3);
});

test('resolveCss: falls to the test when no explicit CSS', () => {
  const t: SwimTest = { kind: 'css_400_200', t400Sec: 300, t200Sec: 140 };
  assert.equal(resolveCss({ swimTest: t }), cssFrom400_200(300, 140));
});

test('resolveCss: null when there is no anchor at all', () => {
  assert.equal(resolveCss({}), null);
});

// --- resolveSwimZones (the resolvePowerZones twin) ---------------------------

test('resolveSwimZones: builds CSS-relative zones from the anchor', () => {
  const z = resolveSwimZones({ cssMetersPerSec: 1.25 }); // CSS pace = 80 s/100
  assert.equal(z.kind, 'swim');
  assert.equal(z.cssMetersPerSec, 1.25);
  assert.ok(Math.abs(z.cssPaceSecPer100 - 80) < 1e-6);
  // threshold straddles CSS pace (±2 s/100 by default).
  assert.ok(z.zones.threshold.fastSecPer100 < 80 && z.zones.threshold.slowSecPer100 > 80);
  // sprint is faster (fewer sec/100) than aerobic.
  assert.ok(z.zones.sprint.fastSecPer100 < z.zones.aerobic.fastSecPer100);
});

test('resolveSwimZones: throws when no anchor (no HR fallback on the swim side)', () => {
  assert.throws(() => resolveSwimZones({}), /no fitness anchor/);
});
