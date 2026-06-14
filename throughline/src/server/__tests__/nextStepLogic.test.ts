import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNextStep, type NextStepInput } from '../nextStepLogic';

const base: NextStepInput = {
  firstName: 'Sam',
  hasAnchor: true,
  hasGoal: true,
  goalDone: false,
  layoffDays: 0,
  easeBackAvailable: false,
  easeBackApplied: false,
  ranToday: false,
  today: { sessionType: 'easy', miles: 5, paceLabel: '8:30/mi', eased: false },
};

test('no anchor wins over everything', () => {
  const s = decideNextStep({ ...base, hasAnchor: false, hasGoal: false, ranToday: true });
  assert.equal(s.kind, 'setup_fitness');
  assert.equal(s.cta.type, 'scroll');
});

test('anchor but no goal → set_goal', () => {
  assert.equal(decideNextStep({ ...base, hasGoal: false }).kind, 'set_goal');
});

test('goal in the past → goal_done', () => {
  assert.equal(decideNextStep({ ...base, goalDone: true }).kind, 'goal_done');
});

test('returning, not yet eased → ease_back CTA', () => {
  const s = decideNextStep({ ...base, layoffDays: 9, easeBackAvailable: true });
  assert.equal(s.kind, 'ease_back');
  assert.equal(s.cta.type, 'ease_back');
  assert.match(s.detail, /9 days/);
});

test('ran today → done_today with view-run CTA', () => {
  const s = decideNextStep({ ...base, ranToday: true });
  assert.equal(s.kind, 'done_today');
  assert.equal(s.cta.type, 'view_run');
});

test('rest day → rest_today, no CTA', () => {
  assert.equal(decideNextStep({ ...base, today: { sessionType: 'rest', miles: 0, eased: false } }).kind, 'rest_today');
  assert.equal(decideNextStep({ ...base, today: null }).kind, 'rest_today');
});

test('eased + session today → eased_today announce names the session', () => {
  const s = decideNextStep({ ...base, easeBackApplied: true, today: { sessionType: 'intervals', miles: 5.8, paceLabel: '6:00/mi', eased: true } });
  assert.equal(s.kind, 'eased_today');
  assert.match(s.detail, /Intervals 5.8 mi/);
  assert.match(s.detail, /eased/i);
});

test('normal session today → today focal action', () => {
  const s = decideNextStep(base);
  assert.equal(s.kind, 'today');
  assert.match(s.headline, /Easy 5 mi/);
});

test('done_today beats eased_today (the run is logged)', () => {
  const s = decideNextStep({ ...base, ranToday: true, easeBackApplied: true });
  assert.equal(s.kind, 'done_today');
});
