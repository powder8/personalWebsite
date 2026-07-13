import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mondayOf, bucketByWeek, distribution } from '../adminAnalyticsLogic';

test('mondayOf anchors any weekday to its Monday', () => {
  assert.equal(mondayOf('2026-07-06'), '2026-07-06'); // a Monday maps to itself
  assert.equal(mondayOf('2026-07-09'), '2026-07-06'); // Thursday
  assert.equal(mondayOf('2026-07-12'), '2026-07-06'); // Sunday
  assert.equal(mondayOf('2026-07-13'), '2026-07-13'); // next Monday
});

test('bucketByWeek keeps empty weeks and ignores out-of-window dates', () => {
  const buckets = bucketByWeek(['2026-07-07', '2026-07-08', '2026-06-30', '2020-01-01'], '2026-07-09', 4);
  assert.equal(buckets.length, 4);
  // Oldest → newest, consecutive Mondays ending with the current week.
  assert.deepEqual(
    buckets.map((b) => b.weekStart),
    ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'],
  );
  assert.deepEqual(
    buckets.map((b) => b.count),
    [0, 0, 1, 2], // ancient date dropped; empty weeks preserved
  );
});

test('distribution counts, drops nulls, sorts by count then key', () => {
  const d = distribution(['easy', 'long', 'easy', null, undefined, 'tempo', 'long', 'easy']);
  assert.deepEqual(d, [
    { key: 'easy', count: 3 },
    { key: 'long', count: 2 },
    { key: 'tempo', count: 1 },
  ]);
});

test('bucketByWeek with no dates is all zeros, correct length', () => {
  const buckets = bucketByWeek([], '2026-07-09', 12);
  assert.equal(buckets.length, 12);
  assert.ok(buckets.every((b) => b.count === 0));
});
