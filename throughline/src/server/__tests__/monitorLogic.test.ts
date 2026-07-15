import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRecoveryEase, injuryCheckDue, addDaysISO } from '../monitorLogic';
import type { Band } from '@/server/console';

const E: Band = 'easy';
const N: Band = 'normal';
const G: Band = 'go';

test('one low day is not enough — the daily gate handles that, not the plan', () => {
  assert.equal(decideRecoveryEase([N, N, E]), null);
  assert.equal(decideRecoveryEase([G, N, E]), null);
});

test('two of the last three low → a modest ~15% ease', () => {
  const ease = decideRecoveryEase([N, E, E]);
  assert.ok(ease);
  assert.equal(ease!.factor, 0.85);
  assert.match(ease!.reason, /trend/i);
});

test('three straight low → a deeper ~25% ease', () => {
  const ease = decideRecoveryEase([E, E, E]);
  assert.ok(ease);
  assert.equal(ease!.factor, 0.75);
  assert.match(ease!.reason, /3 days/);
});

test('only looks at the trailing three days', () => {
  // Two easy days but they are older than the last three → no action.
  assert.equal(decideRecoveryEase([E, E, N, N, N]), null);
  // Two easy within the last three → action.
  assert.ok(decideRecoveryEase([N, N, E, N, E]));
});

test('insufficient signal (fewer than 2 assessed of last 3) → no action', () => {
  assert.equal(decideRecoveryEase([E, null, null]), null);
  assert.equal(decideRecoveryEase([null, null, E]), null);
});

test('injuryCheckDue fires on or after the self-set date', () => {
  assert.equal(injuryCheckDue('2026-07-20', '2026-07-19'), false);
  assert.equal(injuryCheckDue('2026-07-20', '2026-07-20'), true);
  assert.equal(injuryCheckDue('2026-07-20', '2026-07-25'), true);
  assert.equal(injuryCheckDue(null, '2026-07-25'), false);
});

test('addDaysISO handles month/year boundaries', () => {
  assert.equal(addDaysISO('2026-07-30', 3), '2026-08-02');
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysISO('2026-07-10', -4), '2026-07-06');
});
