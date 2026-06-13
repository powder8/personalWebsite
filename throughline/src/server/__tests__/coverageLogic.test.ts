import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDueDraftWeeks, isDayCovered, isCurrentWeekPublished, type PlanWeekRef } from '../coverageLogic';

// Dana's real shape: published plan ended last week; current + future are drafts.
const DANA: PlanWeekRef[] = [
  { id: 'p1', status: 'published', weekStart: '2026-06-01', weekEnd: '2026-06-07' },
  { id: 'd1', status: 'draft', weekStart: '2026-06-08', weekEnd: '2026-06-14' }, // current week
  { id: 'd2', status: 'draft', weekStart: '2026-06-15', weekEnd: '2026-06-21' }, // next week
  { id: 'd3', status: 'draft', weekStart: '2026-06-22', weekEnd: '2026-06-28' }, // beyond horizon
  { id: 'd4', status: 'draft', weekStart: '2026-07-20', weekEnd: '2026-07-26' },
];
const TODAY = '2026-06-13';

test('current week is NOT published for a draft-stuck athlete', () => {
  assert.equal(isCurrentWeekPublished(DANA, TODAY), false);
  assert.equal(isDayCovered(DANA, TODAY), true); // covered, just not published
});

test('rolling horizon publishes the current + next draft week only', () => {
  const due = selectDueDraftWeeks(DANA, TODAY); // default 7d → through 2026-06-20
  assert.deepEqual(due, ['d1', 'd2']); // current + next; d3/d4 stay draft for review
});

test('past draft weeks are never published', () => {
  const withPast: PlanWeekRef[] = [{ id: 'old', status: 'draft', weekStart: '2026-05-25', weekEnd: '2026-05-31' }];
  assert.deepEqual(selectDueDraftWeeks(withPast, TODAY, 10), []);
});

test('autonomous athlete (all published) → nothing to publish', () => {
  const auto: PlanWeekRef[] = [
    { id: 'a', status: 'published', weekStart: '2026-06-08', weekEnd: '2026-06-14' },
    { id: 'b', status: 'published', weekStart: '2026-06-15', weekEnd: '2026-06-21' },
  ];
  assert.deepEqual(selectDueDraftWeeks(auto, TODAY, 10), []);
  assert.equal(isCurrentWeekPublished(auto, TODAY), true);
});

test('no plan at all → current week uncovered', () => {
  assert.equal(isDayCovered([], TODAY), false);
  assert.equal(isCurrentWeekPublished([], TODAY), false);
});
