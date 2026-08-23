import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckinMessage } from '../progressCheckinLogic';

const base = {
  firstName: 'Peter',
  distanceLabel: 'Marathon',
  projectedLabel: '4:28',
  goalLabel: '2:50',
  daysToGoal: 300,
  fitnessChangePct: 9,
  fitnessDirection: 'climbing' as const,
  onPace: false,
};

test('a climbing, not-yet-on-pace check-in reports the trend + projection + goal', () => {
  const m = buildCheckinMessage(base);
  assert.match(m.subject, /marathon/i);
  assert.match(m.body, /climbed \+9%/i);
  assert.match(m.body, /about 4:28/);
  assert.match(m.body, /2:50 goal/);
  assert.match(m.body, /300 days out/);
  assert.match(m.body, /keeps closing/i);
});

test('on pace → the subject celebrates and the body says so', () => {
  const m = buildCheckinMessage({ ...base, onPace: true, projectedLabel: '2:48' });
  assert.match(m.subject, /on pace/i);
  assert.match(m.body, /projecting to hit it/i);
});

test('flat fitness → a "steady but flat" nudge, no fake improvement', () => {
  const m = buildCheckinMessage({ ...base, fitnessDirection: 'holding', fitnessChangePct: 1 });
  assert.match(m.body, /held flat/i);
  assert.match(m.body, /flat/i);
  assert.doesNotMatch(m.body, /climbed/i);
});

test('declining fitness → an honest "stalled" message', () => {
  const m = buildCheckinMessage({ ...base, fitnessDirection: 'declining', fitnessChangePct: -6 });
  assert.match(m.body, /slipped -6%/i);
  assert.match(m.body, /stalled/i);
});

test('no distance/goal set → still a coherent message', () => {
  const m = buildCheckinMessage({ ...base, distanceLabel: null, goalLabel: null });
  assert.ok(m.subject.length > 0 && m.body.includes('Peter'));
  assert.doesNotMatch(m.body, /goal\b(?!.)/); // no dangling "goal" clause
});
