import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planToolAction, type PlannedAction } from '../chatToolPlan';

function directive(p: PlannedAction) {
  assert.ok('type' in p && p.type === 'directive', 'expected a directive action');
  return (p as Extract<PlannedAction, { type: 'directive' }>).directive;
}

test('rest → unavailable directive for the given day', () => {
  const d = directive(planToolAction('request_training_adjustment', { adjustment: 'rest', from: '2026-06-13', note: 'travelling' }));
  assert.equal(d.type, 'unavailable');
  assert.ok(d.label?.includes('travelling'));
});

test('reduced_mileage → reduce_volume with a factor', () => {
  const d = directive(planToolAction('request_training_adjustment', { adjustment: 'reduced_mileage', from: '2026-06-20', to: '2026-06-22' }));
  assert.equal(d.type, 'reduce_volume');
  assert.ok((d.factor ?? 0) > 0 && (d.factor ?? 1) < 1);
});

test('easier paces → positive deltaSecPerMile; faster → negative', () => {
  assert.equal(directive(planToolAction('adjust_paces_window', { direction: 'easier', secondsPerMile: 12, from: '2026-06-09' })).deltaSecPerMile, 12);
  assert.equal(directive(planToolAction('adjust_paces_window', { direction: 'faster', secondsPerMile: 8, from: '2026-06-09' })).deltaSecPerMile, -8);
});

test('anchor from a race carries the engine race shape', () => {
  const p = planToolAction('set_fitness_anchor', { kind: 'race', raceDistanceMeters: 5000, raceTimeSeconds: 1110 });
  assert.ok('type' in p && p.type === 'anchor' && p.anchor.kind === 'race' && p.anchor.distanceMeters === 5000);
});

test('bad dates, out-of-range magnitudes, and bad VDOT are rejected', () => {
  assert.ok('error' in planToolAction('request_training_adjustment', { adjustment: 'rest', from: 'June 13' }));
  assert.ok('error' in planToolAction('adjust_paces_window', { direction: 'easier', secondsPerMile: 999, from: '2026-06-09' }));
  assert.ok('error' in planToolAction('set_fitness_anchor', { kind: 'vdot', vdot: 200 }));
  assert.ok('error' in planToolAction('adjust_paces_window', { direction: 'sideways', secondsPerMile: 5, from: '2026-06-09' }));
});

test('set_training_goal: race-for-time maps to a full goal input', () => {
  const p = planToolAction('set_training_goal', {
    kind: 'time',
    distanceLabel: '5K',
    date: '2026-08-08',
    targetTimeSeconds: 21 * 60 + 30,
    currentWeeklyMiles: 20,
  });
  assert.ok('type' in p && p.type === 'goal');
  const g = (p as Extract<typeof p, { type: 'goal' }>).goal;
  assert.equal(g.kind, 'time');
  assert.equal(g.distanceLabel, '5K');
  assert.equal(g.fitness.kind, 'existing');
  assert.ok((p as Extract<typeof p, { type: 'goal' }>).describe.includes('21:30'));
});

test('set_training_goal: recentRace overrides the fitness source; fitness kind needs no date', () => {
  const p = planToolAction('set_training_goal', {
    kind: 'finish',
    distanceLabel: '10K',
    date: '2026-09-01',
    currentWeeklyMiles: 15,
    recentRace: { distanceLabel: '5K', timeSeconds: 1350 },
  });
  assert.ok('type' in p && p.type === 'goal' && p.goal.fitness.kind === 'race');
  const f = planToolAction('set_training_goal', { kind: 'fitness', currentWeeklyMiles: 12 });
  assert.ok('type' in f && f.type === 'goal' && f.goal.kind === 'fitness');
});

test('set_training_goal: rejects missing date/distance/time/mileage', () => {
  assert.ok('error' in planToolAction('set_training_goal', { kind: 'time', distanceLabel: '5K', date: 'Aug 8', targetTimeSeconds: 1290, currentWeeklyMiles: 20 }));
  assert.ok('error' in planToolAction('set_training_goal', { kind: 'finish', date: '2026-08-08', currentWeeklyMiles: 20 }));
  assert.ok('error' in planToolAction('set_training_goal', { kind: 'time', distanceLabel: '5K', date: '2026-08-08', currentWeeklyMiles: 20 }));
  assert.ok('error' in planToolAction('set_training_goal', { kind: 'finish', distanceLabel: '5K', date: '2026-08-08' }));
});

test('unknown tool name → error', () => {
  assert.ok('error' in planToolAction('definitely_not_a_tool', {}));
});
