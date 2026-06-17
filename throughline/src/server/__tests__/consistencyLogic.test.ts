import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeConsistency, type ConsistencyDay } from '../consistencyLogic';
import type { DayStatus } from '@/server/compliance';

const day = (d: string, status: DayStatus, miles = status === 'done' || status === 'extra' ? 4 : 0): ConsistencyDay => ({
  day: d,
  status,
  actualMiles: miles,
});

test('current streak counts trailing on-plan days, breaks on a miss', () => {
  const days = [
    day('2026-06-09', 'done'),
    day('2026-06-10', 'missed'),
    day('2026-06-11', 'done'),
    day('2026-06-12', 'rest'),
    day('2026-06-13', 'done'),
  ];
  const s = computeConsistency({ today: '2026-06-14', days, weeklyAdherence: [] });
  assert.equal(s.currentStreak, 3); // 11,12,13
  assert.equal(s.longestStreak, 3);
});

test('weeks hit counts only weeks at >=80%', () => {
  const s = computeConsistency({ today: '2026-06-14', days: [day('2026-06-13', 'done')], weeklyAdherence: [100, 80, 50, null] });
  assert.equal(s.weeksTracked, 3);
  assert.equal(s.weeksHit, 2);
  assert.equal(s.adherence28dPct, Math.round((100 + 80 + 50) / 3));
});

test('runs + miles counted within the last 28 days only', () => {
  const days = [
    day('2026-05-01', 'done', 6), // outside 28d
    day('2026-06-10', 'done', 5),
    day('2026-06-12', 'extra', 3),
  ];
  const s = computeConsistency({ today: '2026-06-14', days, weeklyAdherence: [] });
  assert.equal(s.runs28d, 2);
  assert.equal(s.miles28d, 8);
});

test('show gates on real run history', () => {
  const none = computeConsistency({ today: '2026-06-14', days: [day('2026-06-13', 'upcoming')], weeklyAdherence: [] });
  assert.equal(none.show, false);
  const some = computeConsistency({
    today: '2026-06-14',
    days: [day('2026-06-12', 'done'), day('2026-06-13', 'done')],
    weeklyAdherence: [],
  });
  assert.equal(some.show, true);
});

test('upcoming days do not break a streak', () => {
  const days = [day('2026-06-12', 'done'), day('2026-06-13', 'done'), day('2026-06-14', 'upcoming')];
  const s = computeConsistency({ today: '2026-06-14', days, weeklyAdherence: [] });
  assert.equal(s.currentStreak, 2);
});

test('cross-training keeps the streak alive and is credited as active', () => {
  // Missed the planned run, but cross-trained that day → streak should NOT break.
  const days: ConsistencyDay[] = [
    { day: '2026-06-11', status: 'done', actualMiles: 5 },
    { day: '2026-06-12', status: 'missed', actualMiles: 0, crossTrain: true }, // biked instead
    { day: '2026-06-13', status: 'done', actualMiles: 4 },
  ];
  const s = computeConsistency({ today: '2026-06-14', days, weeklyAdherence: [] });
  assert.equal(s.currentStreak, 3); // 11,12 (XT),13 all count
  assert.equal(s.crossTrain28d, 1);
  assert.equal(s.activeDays28d, 3); // 2 runs + 1 cross-train day
  assert.equal(s.runs28d, 2); // cross-training is NOT counted as a run
});

test('a missed run with no cross-training still breaks the streak', () => {
  const days: ConsistencyDay[] = [
    { day: '2026-06-12', status: 'done', actualMiles: 5 },
    { day: '2026-06-13', status: 'missed', actualMiles: 0 },
  ];
  const s = computeConsistency({ today: '2026-06-14', days, weeklyAdherence: [] });
  assert.equal(s.currentStreak, 0); // most recent day (13) was a true miss
});

test('cross-training alone is enough to show the strip', () => {
  const days: ConsistencyDay[] = [
    { day: '2026-06-12', status: 'rest', actualMiles: 0, crossTrain: true },
    { day: '2026-06-13', status: 'rest', actualMiles: 0, crossTrain: true },
  ];
  const s = computeConsistency({ today: '2026-06-14', days, weeklyAdherence: [] });
  assert.equal(s.show, true);
  assert.equal(s.activeDays28d, 2);
});
