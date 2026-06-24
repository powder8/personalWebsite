import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAnchorUpdate, type AnchorDecisionInput } from '@/server/anchorLogic';

const base: AnchorDecisionInput = {
  currentVdot: 33.4,
  anchorSource: 'manual',
  autonomous: true,
  best: { vdot: 41, day: '2026-06-01' },
  today: '2026-06-20',
  relevanceDays: 180,
  upgradeDelta: 2,
};

test("Peter's case: autonomous, stated anchor far slower than a recent race → re-anchor", () => {
  const d = decideAnchorUpdate(base);
  assert.equal(d.set, true);
});

test('never auto-downgrades a human anchor (a slower recent effort is ignored)', () => {
  const d = decideAnchorUpdate({ ...base, currentVdot: 41, best: { vdot: 35, day: '2026-06-10' } });
  assert.equal(d.set, false);
});

test('respects a coach-set anchor for a coached (non-autonomous) athlete', () => {
  const d = decideAnchorUpdate({ ...base, autonomous: false });
  assert.equal(d.set, false);
});

test('an old PR past the relevance window never anchors', () => {
  const d = decideAnchorUpdate({ ...base, best: { vdot: 41, day: '2025-01-01' } }); // ~1.5y old
  assert.equal(d.set, false);
  assert.match(d.reason, /relevance window/);
});

test('autonomous athlete with no anchor yet adopts the demonstrated race', () => {
  const d = decideAnchorUpdate({ ...base, currentVdot: null });
  assert.equal(d.set, true);
});

test('auto anchor tracks the best recent effort (both directions)', () => {
  assert.equal(decideAnchorUpdate({ ...base, anchorSource: 'auto', currentVdot: 33, best: { vdot: 41, day: '2026-06-10' } }).set, true);
  assert.equal(decideAnchorUpdate({ ...base, anchorSource: 'auto', currentVdot: 45, best: { vdot: 41, day: '2026-06-10' } }).set, true);
});

test('auto anchor does not churn when already at ~this fitness', () => {
  const d = decideAnchorUpdate({ ...base, anchorSource: 'auto', currentVdot: 41.2, best: { vdot: 41, day: '2026-06-10' } });
  assert.equal(d.set, false);
});

test('no demonstrated effort → keep current', () => {
  assert.equal(decideAnchorUpdate({ ...base, best: null }).set, false);
});

test('manual anchor only overridden when the gap clears the upgrade delta', () => {
  // 34.5 vs 33.4 manual = +1.1, under the 2.0 delta → keep manual.
  const d = decideAnchorUpdate({ ...base, best: { vdot: 34.5, day: '2026-06-10' } });
  assert.equal(d.set, false);
});
