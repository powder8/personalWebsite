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

test('unrealistic goal → at_risk: explains the gap, keeps the goal, offers a real path', () => {
  const g = buildGoalTracker({ ...base, feasibility: feas('unrealistic'), consistency: consistency(95, 4) })!;
  assert.equal(g.verdict, 'at_risk');
  assert.equal(g.tone, 'risk');
  // Transparency: the honest "why" is surfaced from the feasibility model.
  assert.ok(g.gapNote, 'shows the gap explanation');
  assert.match(g.gapNote!, /project|runway|weeks|faster/i);
  // Voice: collaborative, not a scold — keep the goal, here is the path.
  assert.match(g.advocateLine, /season target|adjust it below/i);
  assert.doesNotMatch(g.headline, /isn't this race|aim honestly/i);
  // The CTA is actionable, not a dead end.
  assert.ok(g.cta, 'offers an adjust-the-goal CTA');
  assert.match(g.cta!.label, /adjust/i);
});

test('at_risk + slipping → attributes the two levers (consistency vs runway), no scold badge', () => {
  const g = buildGoalTracker({
    ...base,
    feasibility: { ...feas('unrealistic'), weeksNeededForGoal: 30, weeksToRace: 11 },
    consistency: consistency(40, 1), // slipping
  })!;
  assert.equal(g.verdict, 'at_risk');
  // Consistency lever is surfaced IN CONTEXT — it protects the realistic
  // projection, and the copy says the projection already assumes it.
  assert.match(g.advocateLine, /assumes consistent training/i);
  assert.match(g.advocateLine, /protect it/i);
  // Frames ongoing EVALUATION, not a push to lower the goal.
  assert.match(g.advocateLine, /trajectory/i);
  assert.doesNotMatch(g.advocateLine, /adjust it below|more room/i);
  // Runway framing for the goal itself lives in the gap note.
  assert.match(g.gapNote!, /season goal/i);
  // No separate "runs logged" badge — the read is woven in, not a scold.
  assert.equal(g.execNote, null);
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

// Advice must fit the countdown: no promising "two solid weeks" inside race week.
const driftingSoon: BuildGoalTrackerInput = {
  ...base,
  feasibility: null,
  target: null,
  daysAway: 5,
  consistency: consistency(22, 1), // 78% under plan
};

test('drifting far out → still offers the two-week rebuild', () => {
  const g = buildGoalTracker({ ...driftingSoon, daysAway: 84 })!;
  assert.equal(g.verdict, 'drifting');
  assert.match(g.advocateLine, /two solid weeks/);
});

test('drifting with 5 days to go → NO impossible two-week advice (the maths must math)', () => {
  const g = buildGoalTracker(driftingSoon)!;
  assert.equal(g.verdict, 'drifting');
  assert.doesNotMatch(g.advocateLine, /two solid weeks|two weeks/);
  assert.match(g.advocateLine, /5 days out/);
});

test('drifting on race eve → arrive-rested framing, no cramming', () => {
  const g = buildGoalTracker({ ...driftingSoon, daysAway: 1 })!;
  assert.doesNotMatch(g.advocateLine, /weeks/);
  assert.match(g.advocateLine, /banked|rest/i);
});

// --- distance context + out-of-reach outlook -------------------------------

test('the tracker carries the goal distance so the target time has context', () => {
  const g = buildGoalTracker({ ...base, distanceLabel: 'Marathon', feasibility: feas('on_track'), consistency: consistency(90, 4) })!;
  assert.equal(g.distanceLabel, 'Marathon');
});

test('an out-of-reach goal gets a PACE-grounded outlook + cadence + factors', () => {
  const g = buildGoalTracker({
    ...base,
    distanceLabel: 'Marathon',
    distanceMeters: 42195,
    units: 'mi',
    targetTimeSeconds: 10200, // 2:50 goal
    target: { solidSeconds: 16080, stretchSeconds: 15600 }, // ~4:28 at current fitness
    feasibility: { ...feas('unrealistic'), projectedTimeSeconds: 16080, weeksNeededForGoal: 104, weeksToRace: 43 },
    consistency: consistency(90, 4),
  })!;
  assert.equal(g.verdict, 'at_risk');
  assert.ok(g.outlook, 'outlook present for an out-of-reach goal');
  // Grounded in pace + the gap from today, not an abstract multiplier.
  assert.match(g.outlook!.requirement, /Today you're around \d+:\d\d\/mi/);
  assert.match(g.outlook!.requirement, /faster/);
  assert.match(g.outlook!.requirement, /104-week build against the 43/);
  assert.match(g.outlook!.cadence, /every 4 weeks/i);
  assert.match(g.outlook!.factors, /injury-free|recovery|consistent/i);
});

test('the pace clause switches to /km when the athlete uses kilometers', () => {
  const g = buildGoalTracker({
    ...base,
    distanceLabel: 'Marathon',
    distanceMeters: 42195,
    units: 'km',
    targetTimeSeconds: 10200,
    target: { solidSeconds: 16080, stretchSeconds: 15600 },
    feasibility: { ...feas('unrealistic'), projectedTimeSeconds: 16080, weeksNeededForGoal: 104, weeksToRace: 43 },
    consistency: consistency(90, 4),
  })!;
  assert.match(g.outlook!.requirement, /\/km faster/);
});

test('an on-track goal has no outlook (nothing to spell out)', () => {
  const g = buildGoalTracker({ ...base, feasibility: feas('on_track'), consistency: consistency(90, 4) })!;
  assert.equal(g.outlook, null);
});
