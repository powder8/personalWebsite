import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeByWeek } from '../weeklyVolumeLogic';

const WEEKS = ['2026-08-03', '2026-08-10', '2026-08-17'];

test('minutes bucket into their week by sport', () => {
  const { byWeek, sports } = buildTimeByWeek(
    [
      { weekStart: '2026-08-10', sport: 'bike', minutes: 90 },
      { weekStart: '2026-08-10', sport: 'bike', minutes: 30 },
      { weekStart: '2026-08-10', sport: 'run', minutes: 45 },
      { weekStart: '2026-08-17', sport: 'swim', minutes: 40 },
    ],
    WEEKS,
  );
  assert.deepEqual(byWeek[1].bySport, { bike: 120, run: 45 }, 'same-sport minutes sum within a week');
  assert.deepEqual(byWeek[2].bySport, { swim: 40 });
  assert.deepEqual(byWeek[0].bySport, {}, 'a week with no sessions is empty, not missing');
});

test('sports come back in canonical order (swim, bike, run, strength), extras last', () => {
  const { sports } = buildTimeByWeek(
    [
      { weekStart: '2026-08-10', sport: 'run', minutes: 30 },
      { weekStart: '2026-08-10', sport: 'yoga', minutes: 60 },
      { weekStart: '2026-08-10', sport: 'swim', minutes: 20 },
      { weekStart: '2026-08-10', sport: 'strength', minutes: 40 },
      { weekStart: '2026-08-10', sport: 'bike', minutes: 50 },
    ],
    WEEKS,
  );
  assert.deepEqual(sports, ['swim', 'bike', 'run', 'strength', 'yoga']);
});

test('zero/negative minutes and out-of-window rows are ignored', () => {
  const { byWeek, sports } = buildTimeByWeek(
    [
      { weekStart: '2026-08-10', sport: 'bike', minutes: 0 },
      { weekStart: '2026-08-10', sport: 'run', minutes: -5 },
      { weekStart: '2025-01-01', sport: 'swim', minutes: 30 }, // outside window
    ],
    WEEKS,
  );
  assert.deepEqual(sports, [], 'no sport had real time');
  assert.deepEqual(byWeek[1].bySport, {});
});
