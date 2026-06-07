/**
 * Engine unit tests. Zero new deps: Node's built-in test runner via tsx.
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBaseline,
  windowValues,
  banisterTrimp,
  estimateLoad,
  computeFitnessFatigue,
  assessReadiness,
  DEFAULT_PARAMS,
  addDays,
  diffDays,
  dayRange,
  type DailyReading,
} from '../index';

// --- dates ---

test('date arithmetic', () => {
  assert.equal(addDays('2026-01-01', 31), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-01-10', '2026-01-01'), 9);
  assert.equal(dayRange('2026-01-01', '2026-01-03').length, 3);
});

// --- baselines ---

function series(start: string, values: number[]): DailyReading[] {
  return values.map((value, i) => ({ day: addDays(start, i), value }));
}

test('windowValues respects the trailing window', () => {
  const r = series('2026-01-01', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // As of day index 9 (2026-01-10), a 3-day window = last 3 values.
  assert.deepEqual(windowValues(r, '2026-01-10', 3), [8, 9, 10]);
});

test('z-score is computed against the long-window baseline', () => {
  // 60 days of HRV ~ mean 100, then a drop on the final day.
  const base = Array.from({ length: 59 }, () => 100);
  const r = series('2026-01-01', [...base, 80]);
  const asOf = addDays('2026-01-01', 59);
  const b = computeBaseline(r, asOf, { shortDays: 7, longDays: 60 });
  assert.equal(b.n, 60);
  assert.equal(b.latestValue, 80);
  assert.ok(b.latestZ !== null && b.latestZ < 0, 'a drop should yield a negative z');
});

test('insufficient / zero-variance data yields null z, not a divide-by-zero', () => {
  const r = series('2026-01-01', [100, 100, 100]); // std 0
  const b = computeBaseline(r, '2026-01-03', { shortDays: 7, longDays: 60 });
  assert.equal(b.latestZ, null);
});

// --- load ---

test('Banister TRIMP increases with intensity and duration', () => {
  const hr = { restingHr: 50, maxHr: 190 };
  const easy = banisterTrimp(3600, 120, hr);
  const hard = banisterTrimp(3600, 170, hr);
  const longer = banisterTrimp(7200, 120, hr);
  assert.ok(hard > easy, 'higher HR → more load');
  assert.ok(longer > easy, 'longer duration → more load');
  assert.ok(easy > 0);
});

test('estimateLoad flags volume fallback when HR is missing', () => {
  const withHr = estimateLoad({ durationSeconds: 3600, avgHr: 150 }, { restingHr: 50, maxHr: 190 });
  const noHr = estimateLoad({ durationSeconds: 3600 });
  assert.equal(withHr.estimated, false);
  assert.equal(noHr.estimated, true);
  assert.ok(noHr.load > 0);
});

// --- fitness / fatigue ---

test('ATL reacts faster than CTL; rest decays both; TSB = ctl - atl', () => {
  // A single big training day, then a long rest. ATL spikes far above CTL on
  // the day, then — decaying ~6× faster — eventually crosses back below it
  // (the crossover is ~15 days out because ATL started so much higher).
  const loads: DailyReading[] = [{ day: '2026-01-10', value: 100 }];
  const ff = computeFitnessFatigue(loads, '2026-01-01', '2026-01-31');
  const trainDay = ff.find((p) => p.day === '2026-01-10')!;
  const lastDay = ff[ff.length - 1];

  // On the training day, fatigue (short tau) rises more than fitness (long tau).
  assert.ok(trainDay.atl > trainDay.ctl, 'ATL spikes above CTL on a hard day');
  assert.ok(trainDay.tsb < 0, 'form goes negative on a hard day');
  // After enough rest, fatigue has decayed below fitness → form positive.
  assert.ok(lastDay.atl < lastDay.ctl, 'fatigue eventually decays below fitness');
  assert.ok(lastDay.tsb > 0, 'form turns positive after rest');
  // TSB identity holds every day.
  for (const p of ff) assert.ok(Math.abs(p.tsb - (p.ctl - p.atl)) < 1e-9);
});

// --- readiness ---

test('suppressed HRV + high soreness → easy day, HRV cited', () => {
  const r = assessReadiness({
    day: '2026-02-01',
    hrvZ: -2,
    restingHrZ: 1.5,
    sleepZ: -1,
    soreness: 8,
    energy: 3,
    yesterdayRpe: 8,
    hrvDaysSuppressed: 2,
  });
  assert.equal(r.band, 'easy');
  assert.ok(r.score < 50);
  assert.match(r.sentence, /HRV/);
  assert.match(r.sentence, /easy/);
});

test('strong positive signals → go', () => {
  const r = assessReadiness({
    day: '2026-02-01',
    hrvZ: 1.5,
    restingHrZ: -1,
    sleepZ: 1,
    soreness: 1,
    energy: 9,
    yesterdayRpe: 2,
  });
  assert.equal(r.band, 'go');
  assert.ok(r.score > 50);
});

test('readiness is deterministic (same input → identical output)', () => {
  const input = {
    day: '2026-02-01',
    hrvZ: -0.5,
    restingHrZ: 0.3,
    sleepZ: 0.1,
    soreness: 5,
    energy: 5,
    yesterdayRpe: 5,
  };
  assert.deepEqual(assessReadiness(input), assessReadiness(input));
});

test('conservatism dial shifts a borderline call toward easy', () => {
  const input = {
    day: '2026-02-01',
    hrvZ: 0.4,
    restingHrZ: 0,
    sleepZ: 0,
    soreness: 4,
    energy: 6,
    yesterdayRpe: 5,
  };
  const neutral = assessReadiness(input, { ...DEFAULT_PARAMS, conservatism: 0.5 });
  const cautious = assessReadiness(input, { ...DEFAULT_PARAMS, conservatism: 1 });
  assert.ok(cautious.score < neutral.score, 'more conservatism → lower score');
});

test('drivers are sorted by absolute contribution', () => {
  const r = assessReadiness({
    day: '2026-02-01',
    hrvZ: -2,
    restingHrZ: 0.1,
    sleepZ: 0,
    soreness: 5,
    energy: 5,
    yesterdayRpe: 5,
  });
  for (let i = 1; i < r.drivers.length; i++) {
    assert.ok(
      Math.abs(r.drivers[i - 1].contribution) >= Math.abs(r.drivers[i].contribution),
    );
  }
});

test('no signals → safe default sentence, normal band', () => {
  const r = assessReadiness({
    day: '2026-02-01',
    hrvZ: null,
    restingHrZ: null,
    sleepZ: null,
    soreness: null,
    energy: null,
    yesterdayRpe: null,
  });
  assert.equal(r.band, 'normal');
  assert.equal(r.sufficientData, false);
  assert.match(r.sentence, /No signals/);
});
