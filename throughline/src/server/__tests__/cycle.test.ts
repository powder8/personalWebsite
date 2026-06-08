import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCycle, type CycleSettings } from '../cycleMath';

const base: CycleSettings = {
  enabled: true,
  lastStartDate: '2026-06-01',
  avgCycleDays: 28,
  avgPeriodDays: 5,
};

test('disabled or no start date → empty status', () => {
  assert.equal(computeCycle({ ...base, enabled: false }, '2026-06-10').phase, null);
  assert.equal(computeCycle({ ...base, lastStartDate: null }, '2026-06-10').phase, null);
});

test('menstrual phase on the period days', () => {
  const s = computeCycle(base, '2026-06-03'); // day 3 of 5
  assert.equal(s.phase, 'menstrual');
  assert.equal(s.dayInCycle, 3);
});

test('follicular in the first half after period', () => {
  const s = computeCycle(base, '2026-06-10'); // day 10
  assert.equal(s.phase, 'follicular');
});

test('luteal in the second half', () => {
  const s = computeCycle(base, '2026-06-20'); // day 20
  assert.equal(s.phase, 'luteal');
});

test('late luteal flagged in the last ~4 days before next start', () => {
  // next start = 2026-06-29; day 2026-06-26 → 3 days until next
  const s = computeCycle(base, '2026-06-26');
  assert.equal(s.lateLuteal, true);
  assert.equal(s.daysUntilNext, 3);
});

test('not late luteal earlier in the luteal phase', () => {
  const s = computeCycle(base, '2026-06-20'); // 9 days until next
  assert.equal(s.lateLuteal, false);
});

test('rolls forward across multiple elapsed cycles', () => {
  // ~2.5 cycles after start; current cycle start = 2026-07-27
  const s = computeCycle(base, '2026-08-01');
  assert.equal(s.dayInCycle, 6);
  assert.equal(s.phase, 'follicular');
  assert.equal(s.nextStart, '2026-08-24');
});

test('projects three upcoming cycles spaced by avgCycleDays', () => {
  const s = computeCycle(base, '2026-06-10');
  assert.equal(s.upcoming.length, 3);
  assert.equal(s.upcoming[0].start, '2026-06-29');
  assert.equal(s.upcoming[0].periodEnd, '2026-07-03'); // 5-day period
  assert.equal(s.upcoming[1].start, '2026-07-27');
});
