import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSex,
  vo2maxFromVdot,
  percentileForVo2max,
  fitnessAgeForVo2max,
  categoryForPercentile,
  ordinal,
  restingHrContext,
  sleepAssessment,
  meanStd,
  bmi,
  bmiCategory,
} from '../healthLogic';

// ── normalizeSex ────────────────────────────────────────────────────────────
test('normalizeSex maps known values and rejects the rest', () => {
  assert.equal(normalizeSex('male'), 'male');
  assert.equal(normalizeSex('female'), 'female');
  assert.equal(normalizeSex('other'), null);
  assert.equal(normalizeSex(null), null);
  assert.equal(normalizeSex(undefined), null);
  assert.equal(normalizeSex(''), null);
});

// ── vo2maxFromVdot ───────────────────────────────────────────────────────────
test('vo2maxFromVdot is a 1:1 estimate rounded to 0.1, null on bad input', () => {
  assert.equal(vo2maxFromVdot(52.34), 52.3);
  assert.equal(vo2maxFromVdot(60), 60);
  assert.equal(vo2maxFromVdot(null), null);
  assert.equal(vo2maxFromVdot(undefined), null);
  assert.equal(vo2maxFromVdot(0), null);
  assert.equal(vo2maxFromVdot(-5), null);
  assert.equal(vo2maxFromVdot(NaN), null);
});

// ── percentileForVo2max ─────────────────────────────────────────────────────
test('percentileForVo2max: median value returns ~50th for that age/sex', () => {
  // Male 20-29 P50 is 48.0 in the FRIEND table.
  assert.equal(percentileForVo2max(48.0, 'male', 25), 50);
  // Female 40-49 P50 is 26.7.
  assert.equal(percentileForVo2max(26.7, 'female', 45), 50);
});

test('percentileForVo2max: anchor values return their anchor percentiles', () => {
  assert.equal(percentileForVo2max(32.1, 'male', 25), 10); // P10
  assert.equal(percentileForVo2max(55.2, 'male', 25), 75); // P75
  assert.equal(percentileForVo2max(61.8, 'male', 25), 90); // P90
});

test('percentileForVo2max: higher fitness ranks higher; clamped to [1,99]', () => {
  const hi = percentileForVo2max(80, 'male', 25);
  const lo = percentileForVo2max(15, 'male', 25);
  assert.ok(hi != null && hi >= 95 && hi <= 99, `elite got ${hi}`);
  assert.ok(lo != null && lo >= 1 && lo <= 10, `low got ${lo}`);
});

test('percentileForVo2max: same VO2max ranks higher at older age', () => {
  const young = percentileForVo2max(40, 'male', 25)!;
  const old = percentileForVo2max(40, 'male', 65)!;
  assert.ok(old > young, `expected older (${old}) > younger (${young})`);
});

test('percentileForVo2max: age is interpolated between decades', () => {
  // Age 30 sits between the 20-29 (mid 25) and 30-39 (mid 35) rows; the anchor
  // used should sit strictly between those two decades' medians.
  const at30 = percentileForVo2max(45, 'male', 30)!;
  const at25 = percentileForVo2max(45, 'male', 25)!;
  const at35 = percentileForVo2max(45, 'male', 35)!;
  assert.ok(at30 >= at25 && at30 <= at35, `30(${at30}) should be between 25(${at25}) and 35(${at35})`);
});

test('percentileForVo2max: ages outside 20-79 clamp to the nearest decade', () => {
  assert.equal(percentileForVo2max(48.0, 'male', 18), percentileForVo2max(48.0, 'male', 25));
  assert.equal(percentileForVo2max(24.4, 'male', 90), percentileForVo2max(24.4, 'male', 75));
});

test('percentileForVo2max: missing sex or age returns null', () => {
  assert.equal(percentileForVo2max(50, null, 30), null);
  assert.equal(percentileForVo2max(50, 'male', null), null);
  assert.equal(percentileForVo2max(null, 'male', 30), null);
});

// ── fitnessAgeForVo2max ──────────────────────────────────────────────────────
test('fitnessAgeForVo2max: a young decade median maps to that decade', () => {
  // Male P50 at 30-39 is 42.4 → fitness age ~35.
  assert.equal(fitnessAgeForVo2max(42.4, 'male'), 35);
  // Female P50 at 50-59 is 23.4 → ~55.
  assert.equal(fitnessAgeForVo2max(23.4, 'female'), 55);
});

test('fitnessAgeForVo2max: elite fitness floors at 20, very low ceils at 80', () => {
  assert.equal(fitnessAgeForVo2max(80, 'male'), 20);
  assert.equal(fitnessAgeForVo2max(10, 'male'), 80);
});

test('fitnessAgeForVo2max: higher VO2max yields a younger fitness age', () => {
  const fit = fitnessAgeForVo2max(45, 'male')!;
  const unfit = fitnessAgeForVo2max(30, 'male')!;
  assert.ok(fit < unfit, `fitter (${fit}) should be younger than unfit (${unfit})`);
});

test('fitnessAgeForVo2max: null sex or VO2max returns null', () => {
  assert.equal(fitnessAgeForVo2max(45, null), null);
  assert.equal(fitnessAgeForVo2max(null, 'male'), null);
});

// ── categoryForPercentile ────────────────────────────────────────────────────
test('categoryForPercentile: ACSM bands', () => {
  assert.equal(categoryForPercentile(95), 'Superior');
  assert.equal(categoryForPercentile(90), 'Superior');
  assert.equal(categoryForPercentile(75), 'Excellent');
  assert.equal(categoryForPercentile(50), 'Good');
  assert.equal(categoryForPercentile(30), 'Fair');
  assert.equal(categoryForPercentile(10), 'Poor');
  assert.equal(categoryForPercentile(5), 'Very Poor');
  assert.equal(categoryForPercentile(null), null);
});

// ── ordinal ──────────────────────────────────────────────────────────────────
test('ordinal handles the tricky teens and unit digits', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(42), '42nd');
  assert.equal(ordinal(93), '93rd');
  assert.equal(ordinal(100), '100th');
});

// ── restingHrContext ─────────────────────────────────────────────────────────
test('restingHrContext bands', () => {
  assert.equal(restingHrContext(45)?.band, 'athlete');
  assert.equal(restingHrContext(55)?.band, 'excellent');
  assert.equal(restingHrContext(65)?.band, 'good');
  assert.equal(restingHrContext(80)?.band, 'average');
  assert.equal(restingHrContext(105)?.band, 'elevated');
  assert.equal(restingHrContext(null), null);
  assert.equal(restingHrContext(0), null);
});

// ── sleepAssessment ──────────────────────────────────────────────────────────
test('sleepAssessment vs the 7-9h guideline', () => {
  assert.equal(sleepAssessment(8, 0.4)?.status, 'good');
  assert.equal(sleepAssessment(8, 0.4)?.consistency, 'steady');
  assert.equal(sleepAssessment(6.5, 1.5)?.status, 'watch');
  assert.equal(sleepAssessment(6.5, 1.5)?.consistency, 'variable');
  assert.equal(sleepAssessment(5, 0.5)?.status, 'low');
  assert.equal(sleepAssessment(9.5, 0.5)?.status, 'watch');
  assert.equal(sleepAssessment(null, null), null);
  // Consistency needs a std to classify.
  assert.equal(sleepAssessment(8, null)?.consistency, null);
});

// ── meanStd ──────────────────────────────────────────────────────────────────
test('meanStd computes sample mean and std, tolerates sparse input', () => {
  const r = meanStd([6, 8, 10]);
  assert.equal(r.mean, 8);
  assert.equal(r.n, 3);
  assert.ok(Math.abs(r.std! - 2) < 1e-9);
  assert.deepEqual(meanStd([]), { mean: null, std: null, n: 0 });
  const one = meanStd([7]);
  assert.equal(one.mean, 7);
  assert.equal(one.std, null); // std undefined for n=1
});

// ── bmi / bmiCategory ────────────────────────────────────────────────────────
test('bmi computes and classifies, null on bad input', () => {
  assert.equal(bmi(70, 175), 22.9);
  assert.equal(bmiCategory(bmi(70, 175)), 'Healthy');
  assert.equal(bmiCategory(17), 'Underweight');
  assert.equal(bmiCategory(27), 'Overweight');
  assert.equal(bmiCategory(31), 'Obese');
  assert.equal(bmi(null, 175), null);
  assert.equal(bmi(70, 0), null);
  assert.equal(bmiCategory(null), null);
});
