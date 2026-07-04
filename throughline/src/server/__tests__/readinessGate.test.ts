import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReadinessGate, type ReadinessGateInput } from '../readinessGate';

const base: ReadinessGateInput = {
  coachingMode: 'autonomous',
  band: 'easy',
  sessionType: 'intervals',
  ranToday: false,
  isRestDay: false,
  checkedInToday: false,
  energy: null,
  soreness: null,
};

test('assisted mode never gates (coach advises instead)', () => {
  assert.equal(decideReadinessGate({ ...base, coachingMode: 'assisted' }).kind, 'none');
});

test('autonomous + low + quality + not checked in → ask', () => {
  const g = decideReadinessGate(base);
  assert.equal(g.kind, 'ask');
});

test('after checking in feeling rough → ease', () => {
  const g = decideReadinessGate({ ...base, checkedInToday: true, energy: 3, soreness: 6 });
  assert.equal(g.kind, 'ease');
});

test('low energy alone (<=5) counts as rough → ease', () => {
  assert.equal(decideReadinessGate({ ...base, checkedInToday: true, energy: 5, soreness: 2 }).kind, 'ease');
});

test('high soreness alone (>=6) counts as rough → ease', () => {
  assert.equal(decideReadinessGate({ ...base, checkedInToday: true, energy: 8, soreness: 7 }).kind, 'ease');
});

test('checked in feeling good → hold (keep the session, trust the body)', () => {
  const g = decideReadinessGate({ ...base, checkedInToday: true, energy: 8, soreness: 1 });
  assert.equal(g.kind, 'hold');
});

test('normal / go readiness → none', () => {
  assert.equal(decideReadinessGate({ ...base, band: 'normal' }).kind, 'none');
  assert.equal(decideReadinessGate({ ...base, band: 'go' }).kind, 'none');
});

test('easy but non-quality session → none (little intensity to cut)', () => {
  assert.equal(decideReadinessGate({ ...base, sessionType: 'easy' }).kind, 'none');
  assert.equal(decideReadinessGate({ ...base, sessionType: 'recovery' }).kind, 'none');
});

test('already ran, rest day, or no session → none', () => {
  assert.equal(decideReadinessGate({ ...base, ranToday: true }).kind, 'none');
  assert.equal(decideReadinessGate({ ...base, isRestDay: true }).kind, 'none');
  assert.equal(decideReadinessGate({ ...base, sessionType: null }).kind, 'none');
});

test('long runs count as quality for the gate', () => {
  assert.equal(decideReadinessGate({ ...base, sessionType: 'long' }).kind, 'ask');
});
