import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGuardrails, decidePublish } from '../index';

const clean = {
  hasActiveInjury: false,
  recentReadinessBands: ['normal', 'go', 'normal', 'go', 'normal'] as const,
  planChangedSessions: 1,
  planTotalSessions: 7,
  hasRecentData: true,
};

test('clean state passes all guardrails', () => {
  const r = evaluateGuardrails({ ...clean, recentReadinessBands: [...clean.recentReadinessBands] });
  assert.equal(r.pass, true);
  assert.equal(r.escalations.length, 0);
});

test('active injury escalates', () => {
  const r = evaluateGuardrails({ ...clean, recentReadinessBands: [...clean.recentReadinessBands], hasActiveInjury: true });
  assert.equal(r.pass, false);
  assert.ok(r.escalations.some((e) => e.kind === 'active_injury'));
});

test('repeated low readiness escalates', () => {
  const r = evaluateGuardrails({
    ...clean,
    recentReadinessBands: ['easy', 'easy', 'normal', 'easy', 'go'],
  });
  assert.ok(r.escalations.some((e) => e.kind === 'repeated_low_readiness'));
});

test('a large plan swing escalates', () => {
  const r = evaluateGuardrails({
    ...clean,
    recentReadinessBands: [...clean.recentReadinessBands],
    planChangedSessions: 5,
    planTotalSessions: 7,
  });
  assert.ok(r.escalations.some((e) => e.kind === 'large_plan_change'));
});

test('stale data escalates', () => {
  const r = evaluateGuardrails({ ...clean, recentReadinessBands: [...clean.recentReadinessBands], hasRecentData: false });
  assert.ok(r.escalations.some((e) => e.kind === 'stale_data'));
});

test('decidePublish: assisted always defers to a human', () => {
  const pass = evaluateGuardrails({ ...clean, recentReadinessBands: [...clean.recentReadinessBands] });
  assert.equal(decidePublish('assisted', pass), 'draft_assisted');
  const fail = evaluateGuardrails({ ...clean, recentReadinessBands: [...clean.recentReadinessBands], hasActiveInjury: true });
  assert.equal(decidePublish('assisted', fail), 'draft_assisted');
});

test('decidePublish: autonomous auto-publishes only when guardrails pass', () => {
  const pass = evaluateGuardrails({ ...clean, recentReadinessBands: [...clean.recentReadinessBands] });
  assert.equal(decidePublish('autonomous', pass), 'auto_publish');
  const fail = evaluateGuardrails({ ...clean, recentReadinessBands: [...clean.recentReadinessBands], hasActiveInjury: true });
  assert.equal(decidePublish('autonomous', fail), 'hold_for_review');
});
