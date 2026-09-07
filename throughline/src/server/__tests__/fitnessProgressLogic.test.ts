import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSportProgress, metresPerBeat, higherIsBetter } from '../fitnessProgressLogic';

const TODAY = '2026-09-07';

test('metres per beat: speed normalised by heart rate', () => {
  // 10 km in 50 min at 150 bpm → 10000 / (150*50) = 1.333 m/beat
  const v = metresPerBeat({ distanceMeters: 10000, durationSeconds: 50 * 60, avgHr: 150 })!;
  assert.ok(Math.abs(v - 1.3333) < 0.001);
  // Same pace at a LOWER heart rate = fitter = a higher number.
  const fitter = metresPerBeat({ distanceMeters: 10000, durationSeconds: 50 * 60, avgHr: 140 })!;
  assert.ok(fitter > v, 'same speed at lower HR scores higher');
});

test('metres per beat needs distance, duration and HR', () => {
  assert.equal(metresPerBeat({ distanceMeters: 10000, durationSeconds: 3000, avgHr: null }), null);
  assert.equal(metresPerBeat({ distanceMeters: null, durationSeconds: 3000, avgHr: 150 }), null);
  assert.equal(metresPerBeat({ distanceMeters: 10000, durationSeconds: 0, avgHr: 150 }), null);
});

test('VDOT buckets take the CEILING (fitness is a good-day number)', () => {
  const p = buildSportProgress(
    [
      { day: '2026-09-01', value: 48 },
      { day: '2026-09-03', value: 52 }, // best in the latest period
      { day: '2026-09-05', value: 45 },
    ],
    { today: TODAY, metric: 'vdot', periods: 2 },
  );
  assert.equal(p.current, 52, 'best effort in the period wins');
});

test('efficiency buckets take the MEDIAN (typical, not lucky)', () => {
  const p = buildSportProgress(
    [
      { day: '2026-09-01', value: 1.0 },
      { day: '2026-09-03', value: 1.2 },
      { day: '2026-09-05', value: 5.0 }, // outlier ride
    ],
    { today: TODAY, metric: 'efficiency', periods: 2 },
  );
  assert.equal(p.current, 1.2, 'median ignores the outlier');
});

test('a rising trend across periods reads as improving', () => {
  const p = buildSportProgress(
    [
      { day: '2026-06-20', value: 40 }, // older period
      { day: '2026-09-02', value: 44 }, // latest period
    ],
    { today: TODAY, metric: 'vdot', periodDays: 28, periods: 4 },
  );
  assert.equal(p.baseline, 40);
  assert.equal(p.current, 44);
  assert.equal(p.deltaPct, 10);
  assert.equal(p.direction, 'up');
});

test('swim pace is LOWER-is-better: a falling pace is a POSITIVE delta', () => {
  assert.equal(higherIsBetter('swim_pace'), false);
  const p = buildSportProgress(
    [
      { day: '2026-06-20', value: 120 }, // 2:00/100m
      { day: '2026-09-02', value: 108 }, // 1:48/100m — faster
    ],
    { today: TODAY, metric: 'swim_pace', periodDays: 28, periods: 4 },
  );
  assert.equal(p.deltaPct, 10, 'getting faster is +10%, not -10%');
  assert.equal(p.direction, 'up');
});

test('a tiny change is flat, not a trend', () => {
  const p = buildSportProgress(
    [
      { day: '2026-06-20', value: 50 },
      { day: '2026-09-02', value: 50.3 },
    ],
    { today: TODAY, metric: 'vdot', periodDays: 28, periods: 4 },
  );
  assert.equal(p.direction, 'flat');
});

test('one period of data → a current reading but NO claimed trend', () => {
  const p = buildSportProgress([{ day: '2026-09-02', value: 50 }], { today: TODAY, metric: 'vdot', periods: 4 });
  assert.equal(p.current, 50);
  assert.equal(p.baseline, null);
  assert.equal(p.deltaPct, null);
  assert.equal(p.direction, 'unknown');
});

test('no samples → empty, honest result', () => {
  const p = buildSportProgress([], { today: TODAY, metric: 'efficiency', periods: 3 });
  assert.equal(p.current, null);
  assert.equal(p.samples, 0);
  assert.equal(p.direction, 'unknown');
  assert.equal(p.buckets.length, 3);
  assert.ok(p.buckets.every((b) => b.value === null));
});

test('junk values and future days are ignored', () => {
  const p = buildSportProgress(
    [
      { day: '2026-09-02', value: 50 },
      { day: '2026-09-02', value: 0 },
      { day: '2026-09-02', value: NaN },
      { day: '2027-01-01', value: 99 }, // future
    ],
    { today: TODAY, metric: 'vdot', periods: 2 },
  );
  assert.equal(p.samples, 1);
  assert.equal(p.current, 50);
});
