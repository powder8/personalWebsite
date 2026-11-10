import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injuryCheckDue, addDaysISO } from '../monitorLogic';

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
