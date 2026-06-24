import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHardEffort, isRaceEffort, isCorroborated, type Effort } from '@/server/perf';

test('isHardEffort: sustained near-max HR is a genuine effort', () => {
  // Peter's June 20 5K: 192 avg / 202 max → 0.95 ratio.
  assert.equal(isHardEffort({ avgHr: 192, maxHr: 202 }), true);
  // Masters athlete with a lower max still qualifies on ratio.
  assert.equal(isHardEffort({ avgHr: 150, maxHr: 165 }), true);
});

test('isHardEffort: easy running is not a hard effort', () => {
  assert.equal(isHardEffort({ avgHr: 130, maxHr: 190 }), false); // 0.68
  assert.equal(isHardEffort({ avgHr: 145, maxHr: 175 }), false); // 0.83
});

test('isHardEffort: needs both avg and max HR', () => {
  assert.equal(isHardEffort({ avgHr: 190, maxHr: null }), false);
  assert.equal(isHardEffort({ avgHr: null, maxHr: 200 }), false);
  assert.equal(isHardEffort({ avgHr: null, maxHr: null }), false);
});

test('regression: an isolated hard-HR 5K is NOT corroborated by easy runs', () => {
  // This is exactly why the corroboration guard discarded Peter's effort — so the
  // HR exemption is what lets it through. The effort itself remains uncorroborated.
  const peak: Effort = { ts: Date.parse('2026-06-20'), vdot: 40 };
  const easy: Effort[] = [
    peak,
    { ts: Date.parse('2026-06-16'), vdot: 33 },
    { ts: Date.parse('2026-06-13'), vdot: 31 },
  ];
  assert.equal(isCorroborated(peak, easy), false); // nothing within 5 VDOT
  // ...but HR marks it trusted, so the anchor code exempts it from this guard.
  assert.equal(isHardEffort({ avgHr: 192, maxHr: 202 }), true);
});

test('isRaceEffort still independent of HR', () => {
  assert.equal(isRaceEffort({ workoutType: 1, name: null, meters: 5000 }), true);
  assert.equal(isRaceEffort({ workoutType: null, name: 'Morning Run', meters: 5000 }), false);
});
