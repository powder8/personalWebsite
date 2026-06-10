import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../blocks';

const wk = (start: string, end: string, phase: string, miles: number) => ({
  weekStart: start,
  weekEnd: end,
  phase,
  weeklyTargetMeters: miles * 1609.344,
});

const WEEKS = [
  wk('2026-06-01', '2026-06-07', 'base', 20),
  wk('2026-06-08', '2026-06-14', 'base', 24),
  wk('2026-06-15', '2026-06-21', 'build', 28),
  wk('2026-06-22', '2026-06-28', 'build', 32),
  wk('2026-06-29', '2026-07-05', 'peak', 34),
  wk('2026-07-06', '2026-07-12', 'taper', 22),
];

test('groups consecutive same-phase weeks into blocks with mileage ranges', () => {
  const t = buildTimeline(WEEKS, [], '2026-06-10')!;
  assert.equal(t.blocks.length, 4);
  assert.deepEqual(
    t.blocks.map((b) => [b.phase, b.weeks]),
    [['base', 2], ['build', 2], ['peak', 1], ['taper', 1]],
  );
  assert.equal(t.blocks[0].milesMin, 20);
  assert.equal(t.blocks[0].milesMax, 24);
});

test('marks the current block + current week and computes progress', () => {
  const t = buildTimeline(WEEKS, [], '2026-06-17')!;
  assert.equal(t.currentWeek, 3);
  assert.equal(t.blocks.find((b) => b.current)?.phase, 'build');
  assert.ok(t.progress > 0.3 && t.progress < 0.5, `progress ${t.progress}`);
});

test('pins races into the block containing their date; out-of-range races dropped', () => {
  const t = buildTimeline(
    WEEKS,
    [
      { name: 'Tune-up 10K', date: '2026-06-27', priority: 'tune_up', purpose: 'sharpening' },
      { name: 'Old race', date: '2025-01-01', priority: 'goal', purpose: null },
    ],
    '2026-06-10',
  )!;
  const build = t.blocks.find((b) => b.phase === 'build')!;
  assert.equal(build.races.length, 1);
  assert.equal(build.races[0].name, 'Tune-up 10K');
  assert.equal(t.blocks.flatMap((b) => b.races).length, 1);
});

test('empty plan → null; today outside the season clamps progress', () => {
  assert.equal(buildTimeline([], [], '2026-06-10'), null);
  assert.equal(buildTimeline(WEEKS, [], '2027-01-01')!.progress, 1);
  assert.equal(buildTimeline(WEEKS, [], '2025-01-01')!.progress, 0);
  assert.equal(buildTimeline(WEEKS, [], '2027-01-01')!.currentWeek, null);
});
