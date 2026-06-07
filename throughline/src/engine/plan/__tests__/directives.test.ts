import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDirectives, directivesActiveOn, type ActiveDirective } from '../index';

const base = {
  day: '2026-06-10',
  sessionType: 'threshold',
  distanceMeters: 16093, // 10 mi
  paceFastSecPerKm: 220,
  paceSlowSecPerKm: 230,
};

test('directivesActiveOn respects the window (incl. open-ended)', () => {
  const dirs: ActiveDirective[] = [
    { type: 'pace_adjust', from: '2026-06-09', to: '2026-06-12', deltaSecPerMile: 10 },
    { type: 'unavailable', from: '2026-07-01', to: null },
  ];
  assert.equal(directivesActiveOn('2026-06-10', dirs).length, 1);
  assert.equal(directivesActiveOn('2026-06-30', dirs).length, 0);
  assert.equal(directivesActiveOn('2026-08-01', dirs).length, 1); // open-ended
});

test('unavailable turns the day into rest (wins over other adjustments)', () => {
  const r = applyDirectives(base, [
    { type: 'unavailable', from: base.day, to: base.day, label: 'Out of town' },
    { type: 'pace_adjust', from: base.day, to: base.day, deltaSecPerMile: 30 },
  ]);
  assert.equal(r.sessionType, 'rest');
  assert.equal(r.distanceMeters, 0);
  assert.ok(r.adjustments.some((a) => /Out of town/.test(a)));
});

test('pace_adjust slows the paces by the delta (converted to sec/km)', () => {
  const r = applyDirectives(base, [{ type: 'pace_adjust', from: base.day, to: base.day, deltaSecPerMile: 16.09344 }]);
  assert.ok(Math.abs(r.paceFastSecPerKm! - 230) < 0.5, '+~10 s/km'); // 16.09 s/mi ≈ 10 s/km
  assert.ok(r.adjustments.length === 1);
});

test('reduce_volume shortens distance by the factor', () => {
  const r = applyDirectives(base, [{ type: 'reduce_volume', from: base.day, to: base.day, factor: 0.7, label: 'tired' }]);
  assert.ok(Math.abs(r.distanceMeters! - 16093 * 0.7) < 1);
  assert.ok(r.adjustments.some((a) => /70%/.test(a)));
});

test('a session outside any window is unchanged', () => {
  const r = applyDirectives(base, [{ type: 'pace_adjust', from: '2026-01-01', to: '2026-01-05', deltaSecPerMile: 30 }]);
  assert.equal(r.paceFastSecPerKm, 220);
  assert.equal(r.adjustments.length, 0);
});
