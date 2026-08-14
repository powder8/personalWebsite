import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  segmentHeadline,
  sessionMetricLabel,
  formatDuration,
  swimPaceSuffix,
  bikePowerSuffix,
  isBikeSegment,
  isSwimSegment,
  type DisplaySegment,
} from '../segmentDisplayLogic';

// --- RUN: must stay byte-identical to the original SegmentList headline() ------
test('run interval headline is unchanged (reps × repMeters)', () => {
  assert.equal(segmentHeadline({ reps: 6, repMeters: 1000 }), '6 × 0.62 mi');
  assert.equal(segmentHeadline({ reps: 8, repMeters: 400 }), '8 × 400m'); // 400s stay metres
  assert.equal(segmentHeadline({ reps: 5, repMeters: 1609.344 }), '5 × 1.0 mi');
});

test('run continuous headline is unchanged (distanceMeters)', () => {
  assert.equal(segmentHeadline({ distanceMeters: 4023.36 }), '2.5 mi');
  assert.equal(segmentHeadline({ distanceMeters: 800 }), '0.50 mi');
  assert.equal(segmentHeadline({}), '');
});

// --- BIKE: duration at power --------------------------------------------------
test('bike interval headline: reps × minutes @ watt band', () => {
  assert.equal(
    segmentHeadline({ reps: 5, repSeconds: 480, targetLoWatts: 228, targetHiWatts: 263 }),
    '5 × 8 min @ 228–263 W',
  );
});

test('bike continuous headline: minutes @ watt band', () => {
  assert.equal(
    segmentHeadline({ durationSeconds: 2700, targetLoWatts: 150, targetHiWatts: 180 }),
    '45 min @ 150–180 W',
  );
});

test('bike headline without a power meter drops the @ watts suffix', () => {
  assert.equal(segmentHeadline({ reps: 4, repSeconds: 480 }), '4 × 8 min');
  assert.equal(segmentHeadline({ durationSeconds: 3600 }), '60 min');
});

// --- SWIM: metres at CSS pace -------------------------------------------------
test('swim interval headline: reps × metres @ CSS pace band', () => {
  assert.equal(
    segmentHeadline({ reps: 11, repMeters: 100, targetFastSecPer100: 76, targetSlowSecPer100: 80 }),
    '11 × 100 m @ 1:16–1:20/100m',
  );
});

test('swim headline collapses a point band to a single pace', () => {
  assert.equal(
    segmentHeadline({ reps: 11, repMeters: 100, targetFastSecPer100: 78, targetSlowSecPer100: 78 }),
    '11 × 100 m @ 1:18/100m',
  );
});

test('swim continuous / drill headline uses distanceMeters', () => {
  assert.equal(
    segmentHeadline({ distanceMeters: 400, targetFastSecPer100: 88, targetSlowSecPer100: 98 }),
    '400 m @ 1:28–1:38/100m',
  );
});

// --- family detection ---------------------------------------------------------
test('discipline is inferred from the segment fields', () => {
  assert.equal(isBikeSegment({ repSeconds: 480 }), true);
  assert.equal(isSwimSegment({ targetFastSecPer100: 80 }), true);
  const run: DisplaySegment = { reps: 6, repMeters: 1000 };
  assert.equal(isBikeSegment(run), false);
  assert.equal(isSwimSegment(run), false);
});

// --- small formatters ---------------------------------------------------------
test('formatDuration reads whole minutes as minutes, sub-minute as seconds', () => {
  assert.equal(formatDuration(480), '8 min');
  assert.equal(formatDuration(30), '30 s');
  assert.equal(formatDuration(90), '2 min'); // rounds non-whole minutes
});

test('bikePowerSuffix / swimPaceSuffix render bands', () => {
  assert.equal(bikePowerSuffix({ targetLoWatts: 228, targetHiWatts: 263 }), '228–263 W');
  assert.equal(bikePowerSuffix({}), '');
  assert.equal(swimPaceSuffix({ targetFastSecPer100: 76, targetSlowSecPer100: 80 }), '1:16–1:20/100m');
  assert.equal(swimPaceSuffix({}), '');
});

// --- per-day week-view metric in each discipline's currency -------------------
test('sessionMetricLabel: run miles unchanged, bike minutes, swim km', () => {
  assert.equal(
    sessionMetricLabel({ discipline: 'run', distanceMeters: 12874.75, durationSeconds: null }),
    '8.0 mi',
  );
  assert.equal(sessionMetricLabel({ discipline: 'run', distanceMeters: null, durationSeconds: null }), '—');
  assert.equal(
    sessionMetricLabel({ discipline: 'bike', distanceMeters: 0, durationSeconds: 4500 }),
    '75 min',
  );
  assert.equal(
    sessionMetricLabel({ discipline: 'swim', distanceMeters: 2400, durationSeconds: null }),
    '2.4 km',
  );
});
