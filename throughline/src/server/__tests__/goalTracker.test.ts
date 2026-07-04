import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalTracker, type BuildGoalTrackerInput } from '../goalTrackerLogic';
import type { GoalFeasibility, FeasibilityVerdict } from '@/engine/plan';
import type { ConsistencyStats } from '../consistencyLogic';

function feas(verdict: FeasibilityVerdict): GoalFeasibility {
  return {
    verdict,
    currentVdot: 50,
    goalVdot: 53,
    weeksToRace: 12,
    trainableWeeks: 9,
    typicalWeeklyGain: 0.3,
    achievableGain: 2.7,
    projectedVdot: 52.7,
    projectedTimeSeconds: 11220, // 3:07
    requiredWeeklyGain: 0.33,
    weeksNeededForGoal: 10,
    headline: 'x',
    note: 'y',
  };
}

function consistency(adherence: number | null, activeWeeks: number): ConsistencyStats {
  return {
    show: true,
    currentStreak: 3,
    longestStreak: 5,
    weeksTracked: 4,
    weeksHit: 3,
    activeWeeks28d: activeWeeks,
    runs28d: 12,
    miles28d: 120,
    crossTrain28d: 2,
    activeDays28d: 16,
    adherence28dPct: adherence,
    headline: 'x',
  };
}

const base: BuildGoalTrackerInput = {
  goalName: 'Chicago Marathon',
  daysAway: 84,
  targetTimeSeconds: 11100, // 3:05
  target: { solidSeconds: 11220, stretchSeconds: 10980 },
  feasibility: feas('on_track'),
  consistency: consistency(90, 4),
};

test('no goal → null (handled by goal-setup CTA)', () => {
  assert.equal(buildGoalTracker({ ...base, goalName: '' }), null);
});

test('capable + executing → on_track', () => {
  const g = buildGoalTracker(base)!;
  assert.equal(g.verdict, 'on_track');
  assert.equal(g.tone, 'positive');
  assert.match(g.headline, /3:05 is in reach/);
  assert.match(g.projectionLine!, /race day 3:07/);
});

test('capable but execution slipping → drifting (the key fusion case)', () => {
  const g = buildGoalTracker({ ...base, consistency: consistency(55, 1) })!;
  assert.equal(g.verdict, 'drifting');
  assert.equal(g.tone, 'caution');
  assert.match(g.headline, /slipping/);
  assert.match(g.leftLabel, /55% of planned miles/);
});

test('stretch destination + good execution → stretch (honest, hopeful)', () => {
  const g = buildGoalTracker({ ...base, feasibility: feas('stretch') })!;
  assert.equal(g.verdict, 'stretch');
  assert.equal(g.tone, 'caution');
});

test('stretch destination + slipping → drifting', () => {
  const g = buildGoalTracker({ ...base, feasibility: feas('stretch'), consistency: consistency(50, 1) })!;
  assert.equal(g.verdict, 'drifting');
});

test('already at goal fitness → ahead', () => {
  const g = buildGoalTracker({ ...base, feasibility: feas('ahead') })!;
  assert.equal(g.verdict, 'ahead');
  assert.equal(g.tone, 'positive');
});

test('unrealistic goal → at_risk, honest but with a path (even if executing)', () => {
  const g = buildGoalTracker({ ...base, feasibility: feas('unrealistic'), consistency: consistency(95, 4) })!;
  assert.equal(g.verdict, 'at_risk');
  assert.equal(g.tone, 'risk');
  assert.ok(g.cta, 'offers a rework-the-goal CTA');
  assert.match(g.advocateLine, /Chase it/);
});

test('goal race but no time/fitness data → execution-only verdict', () => {
  const g = buildGoalTracker({ ...base, feasibility: null, target: null, targetTimeSeconds: null, consistency: consistency(null, 3) })!;
  assert.equal(g.verdict, 'on_track');
  assert.match(g.projectionLine!, /No target time/);
  assert.ok(g.cta, 'nudges to set a target time');
  assert.match(g.advocateLine, /target time/i);
});

test('goal race, no feasibility, slipping → drifting', () => {
  const g = buildGoalTracker({ ...base, feasibility: null, target: null, targetTimeSeconds: null, consistency: consistency(null, 1) })!;
  assert.equal(g.verdict, 'drifting');
});
