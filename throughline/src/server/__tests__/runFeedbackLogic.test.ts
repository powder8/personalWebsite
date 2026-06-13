import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRun, type PlannedRef } from '../runFeedbackLogic';

// Paces in sec/km. Easy band ~9:00–9:45/mi → ~335–363 s/km. Threshold ~7:00/mi → ~261 s/km.
const easy: PlannedRef = { sessionType: 'easy', zone: 'easy', miles: 5, paceFastSecPerKm: 335, paceSlowSecPerKm: 363 };
const threshold: PlannedRef = { sessionType: 'threshold', zone: 'threshold', miles: 6, paceFastSecPerKm: 255, paceSlowSecPerKm: 268 };

test('easy day run too fast → caution, the classic mistake', () => {
  const f = assessRun({ actualMiles: 5, actualPaceSecPerKm: 300, planned: easy });
  assert.equal(f.verdict, 'too_fast_easy');
  assert.equal(f.positive, false);
  assert.match(f.detail, /easy/i);
});

test('easy day in band → textbook, positive', () => {
  const f = assessRun({ actualMiles: 5, actualPaceSecPerKm: 348, planned: easy });
  assert.equal(f.verdict, 'solid');
  assert.equal(f.positive, true);
});

test('quality in band → nailed it', () => {
  const f = assessRun({ actualMiles: 6, actualPaceSecPerKm: 261, planned: threshold });
  assert.equal(f.verdict, 'nailed');
  assert.equal(f.positive, true);
});

test('quality way too fast → too_hard caution', () => {
  const f = assessRun({ actualMiles: 6, actualPaceSecPerKm: 235, planned: threshold });
  assert.equal(f.verdict, 'too_hard');
  assert.equal(f.positive, false);
});

test('quality slower than band → eased off, still positive', () => {
  const f = assessRun({ actualMiles: 6, actualPaceSecPerKm: 290, planned: threshold });
  assert.equal(f.verdict, 'eased_off');
  assert.equal(f.positive, true);
});

test('no planned session → bonus run', () => {
  const f = assessRun({ actualMiles: 3, actualPaceSecPerKm: 340, planned: null });
  assert.equal(f.verdict, 'extra');
  assert.equal(f.positive, true);
});

test('came up well short on distance → gentle, no make-up-miles', () => {
  const f = assessRun({ actualMiles: 2, actualPaceSecPerKm: null, planned: easy });
  assert.equal(f.verdict, 'short');
  assert.equal(f.positive, true);
  assert.doesNotMatch(f.detail, /make up/i);
});

test('never tells anyone to make up miles', () => {
  const planneds: (PlannedRef | null)[] = [easy, threshold, null, { ...easy, miles: 8 }];
  for (const p of planneds) {
    for (const pace of [null, 250, 300, 350, 400]) {
      const f = assessRun({ actualMiles: 4, actualPaceSecPerKm: pace, planned: p });
      assert.doesNotMatch(f.detail, /make up the (miles|mileage)/i);
    }
  }
});
