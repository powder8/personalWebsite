import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessGoalFeasibility, typicalWeeklyVdotGain } from '../feasibility';

const MARATHON = 42195;
const FIVEK = 5000;

test('improvement rate diminishes as fitness rises', () => {
  assert.ok(typicalWeeklyVdotGain(48) > typicalWeeklyVdotGain(65));
  assert.ok(typicalWeeklyVdotGain(65) >= 0.12);
});

test('already at goal fitness → ahead', () => {
  const f = assessGoalFeasibility({ currentVdot: 60, goalVdot: 58, weeksToRace: 10, goalDistanceMeters: MARATHON });
  assert.equal(f.verdict, 'ahead');
});

test('small gap with time → on_track', () => {
  const f = assessGoalFeasibility({ currentVdot: 52, goalVdot: 54, weeksToRace: 12, goalDistanceMeters: MARATHON });
  assert.equal(f.verdict, 'on_track');
});

test("Moira's case: +12 VDOT in 7 weeks → unrealistic, honest target offered", () => {
  const f = assessGoalFeasibility({ currentVdot: 53, goalVdot: 65, weeksToRace: 7, goalDistanceMeters: MARATHON, goalLabel: '2:38 marathon' });
  assert.equal(f.verdict, 'unrealistic');
  assert.ok(f.achievableGain < 3); // a few weeks can't add 12 VDOT
  assert.ok(f.projectedTimeSeconds > 0);
  assert.ok(f.weeksNeededForGoal! > f.weeksToRace); // needs much longer
  assert.match(f.note, /2:38 marathon/);
});

test('a meaningful-but-plausible gap → stretch', () => {
  const f = assessGoalFeasibility({ currentVdot: 52, goalVdot: 56, weeksToRace: 10, goalDistanceMeters: FIVEK });
  assert.equal(f.verdict, 'stretch');
  assert.ok(f.projectedTimeSeconds > 0);
});

test('taper weeks are excluded from trainable time', () => {
  const f = assessGoalFeasibility({ currentVdot: 50, goalVdot: 55, weeksToRace: 10, goalDistanceMeters: MARATHON });
  assert.equal(f.trainableWeeks, 7); // 10 − 3 taper for a marathon
});
