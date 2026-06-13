import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runningCostOfGrade, gradeAdjustFactor, gapFromSplits } from '../gap';

test('flat grade → factor 1 (no adjustment)', () => {
  assert.equal(gradeAdjustFactor(0), 1);
  assert.ok(Math.abs(runningCostOfGrade(0) - 3.6) < 1e-9);
});

test('uphill costs more → factor > 1; downhill < 1', () => {
  assert.ok(gradeAdjustFactor(0.1) > 1.2); // 10% climb is much harder
  assert.ok(gradeAdjustFactor(-0.1) < 1); // gentle downhill is easier
});

test('flat splits → GAP equals raw, not significant', () => {
  const splits = [
    { distanceMeters: 1000, paceSecPerKm: 240, elevDiffMeters: 0 },
    { distanceMeters: 1000, paceSecPerKm: 240, elevDiffMeters: 0 },
  ];
  const g = gapFromSplits(splits)!;
  assert.ok(Math.abs(g.gapSecPerKm - g.rawSecPerKm) < 1e-6);
  assert.equal(g.significant, false);
});

test('a sustained-climb 5K reads faster on GAP than raw', () => {
  // ~300 ft (≈91 m) of climbing across the 5K, effort held so pace suffers.
  const splits = [
    { distanceMeters: 1000, paceSecPerKm: 268, elevDiffMeters: 18 },
    { distanceMeters: 1000, paceSecPerKm: 270, elevDiffMeters: 20 },
    { distanceMeters: 1000, paceSecPerKm: 272, elevDiffMeters: 19 },
    { distanceMeters: 1000, paceSecPerKm: 266, elevDiffMeters: 17 },
    { distanceMeters: 1000, paceSecPerKm: 269, elevDiffMeters: 17 },
  ];
  const g = gapFromSplits(splits)!;
  assert.ok(g.gapSecPerKm < g.rawSecPerKm, 'sustained climb → GAP faster than raw');
  assert.equal(g.significant, true);
  assert.ok(g.climbMeters >= 90);
});

test('banking fast downhill miles → GAP is honestly SLOWER than raw', () => {
  const splits = [
    { distanceMeters: 1000, paceSecPerKm: 230, elevDiffMeters: -45 }, // fast, but easy
    { distanceMeters: 1000, paceSecPerKm: 232, elevDiffMeters: -46 },
  ];
  const g = gapFromSplits(splits)!;
  assert.ok(g.gapSecPerKm > g.rawSecPerKm, 'downhill speed is not free fitness');
});

test('returns null without usable split data', () => {
  assert.equal(gapFromSplits(null), null);
  assert.equal(gapFromSplits([]), null);
  assert.equal(gapFromSplits([{ distanceMeters: 1000, elevDiffMeters: 10 }]), null); // no time/pace
});

test('derives split time from pace when duration is absent', () => {
  const g = gapFromSplits([{ distanceMeters: 1000, paceSecPerKm: 300, elevDiffMeters: 0 }])!;
  assert.ok(Math.abs(g.rawSecPerKm - 300) < 1e-6);
});
