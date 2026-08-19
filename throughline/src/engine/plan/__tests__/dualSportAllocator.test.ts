import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateDualSportHours, DEFAULT_PRIORITY_BOOST } from '../dualSportAllocatorLogic';

// ── Conservation ─────────────────────────────────────────────────────────────
test('the split conserves the total budget (Σ hours ≈ weeklyHours)', () => {
  const a = allocateDualSportHours({ weeklyHours: 10, disciplines: ['run', 'bike'] });
  const sum = (a.budgets.run!.hours + a.budgets.bike!.hours);
  assert.ok(Math.abs(sum - 10) < 0.11, `Σ ${sum} ≈ 10`);
});

// ── Demand: the bike absorbs more marginal time than the run ──────────────────
test('with no A-goal, the bike earns more of the surplus than the run (lower recovery cost)', () => {
  const a = allocateDualSportHours({ weeklyHours: 12, disciplines: ['run', 'bike'] });
  assert.ok(a.budgets.bike!.hours > a.budgets.run!.hours, `bike ${a.budgets.bike!.hours} > run ${a.budgets.run!.hours}`);
  // ...but the run is never starved below its floor.
  assert.ok(a.budgets.run!.hours >= a.budgets.run!.floorHours - 1e-9);
});

// ── Priority boost tilts toward the A-goal ────────────────────────────────────
test('naming run as the A-goal pulls hours toward the run vs the unprioritised split', () => {
  const neutral = allocateDualSportHours({ weeklyHours: 12, disciplines: ['run', 'bike'] });
  const runFirst = allocateDualSportHours({ weeklyHours: 12, disciplines: ['run', 'bike'], priority: 'run' });
  assert.ok(runFirst.budgets.run!.hours > neutral.budgets.run!.hours, 'run gains hours when it is the A-goal');
  assert.ok(runFirst.budgets.run!.isPriority);
  assert.ok(!runFirst.budgets.bike!.isPriority);
  assert.ok(DEFAULT_PRIORITY_BOOST > 1);
});

// ── One active discipline → it gets the whole budget ─────────────────────────
test('a single active goal receives the entire budget', () => {
  const a = allocateDualSportHours({ weeklyHours: 8, disciplines: ['bike'] });
  assert.equal(a.budgets.run, undefined, 'no run budget when only bike is active');
  assert.ok(Math.abs(a.budgets.bike!.hours - 8) < 0.11, `bike gets ~8 h, got ${a.budgets.bike!.hours}`);
});

// ── Floors first: a tiny budget scales floors, never negative ────────────────
test('a budget below the combined floors scales them down and flags a maintenance week', () => {
  const a = allocateDualSportHours({ weeklyHours: 2, disciplines: ['run', 'bike'] });
  assert.ok(a.floorsScaled, 'floors were scaled');
  assert.ok(a.budgets.run!.hours > 0 && a.budgets.bike!.hours > 0, 'both sports stay live');
  assert.ok(a.budgets.run!.hours + a.budgets.bike!.hours <= 2 + 1e-9, 'never exceeds the tiny budget');
  assert.match(a.notes.join(' '), /maintenance/i);
});

// ── More total hours → more hours everywhere (monotonic) ─────────────────────
test('raising the budget raises both sports’ hours', () => {
  const lo = allocateDualSportHours({ weeklyHours: 8, disciplines: ['run', 'bike'] });
  const hi = allocateDualSportHours({ weeklyHours: 14, disciplines: ['run', 'bike'] });
  assert.ok(hi.budgets.run!.hours > lo.budgets.run!.hours);
  assert.ok(hi.budgets.bike!.hours > lo.budgets.bike!.hours);
});

// ── Degenerate input ─────────────────────────────────────────────────────────
test('no active disciplines → empty budgets, no throw', () => {
  const a = allocateDualSportHours({ weeklyHours: 10, disciplines: [] });
  assert.deepEqual(a.budgets, {});
  assert.equal(a.floorsScaled, false);
});
