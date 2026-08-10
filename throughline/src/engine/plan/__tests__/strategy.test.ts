import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildZones,
  periodize,
  generateWeek,
  generatePlan,
  COACH_TEMPLATE_SET,
  selectStrategy,
  runStrategy,
  bikeStrategy,
  resolvePaceZones,
  assessGoalFeasibility,
} from '../index';

const zones = buildZones(222.5); // elite threshold, matches plan.test.ts fixture

const planInput = {
  startDay: '2026-01-05',
  goalRaceDay: '2026-04-12',
  startVolumeMiles: 64,
  peakVolumeMiles: 70,
};

// --- selection ---

test("selectStrategy('run') returns the run strategy; discipline tag is correct", () => {
  assert.equal(selectStrategy('run'), runStrategy);
  assert.equal(runStrategy.discipline, 'run');
});

test("selectStrategy('bike') returns the bike strategy stub", () => {
  assert.equal(selectStrategy('bike'), bikeStrategy);
  assert.equal(bikeStrategy.discipline, 'bike');
});

// --- run strategy is wired and behaviour is unchanged ---

test('generatePlan with discipline="run" is identical to the pre-discipline default', () => {
  const withRun = generatePlan({ ...planInput, discipline: 'run' }, zones);
  const legacyDefault = generatePlan(planInput, zones); // no discipline → defaults to run
  assert.deepEqual(withRun, legacyDefault);
});

test('generateWeek with the run strategy matches the default (implicit) strategy', () => {
  const weeks = periodize(planInput);
  const buildWeek = weeks.find((w) => w.phase === 'build')!;
  const viaDefault = generateWeek(buildWeek, COACH_TEMPLATE_SET.build, zones);
  const viaRun = generateWeek(buildWeek, COACH_TEMPLATE_SET.build, zones, '', undefined, runStrategy);
  assert.deepEqual(viaRun, viaDefault);
  // And a build week really does exercise the strategy's quality prescription.
  assert.ok(viaRun.days.some((d) => d.runType === 'quality' && (d.segments?.length ?? 0) === 3));
});

test('run strategy delegates to the existing running modules (same outputs)', () => {
  const cfg = { vdot: 55 };
  assert.deepEqual(runStrategy.resolveZones(cfg), resolvePaceZones(cfg));
  assert.equal(runStrategy.resolveFitnessAnchor(cfg), 55);
  const feas = { currentVdot: 50, goalVdot: 55, weeksToRace: 16, goalDistanceMeters: 42195 };
  assert.deepEqual(runStrategy.assessGoalFeasibility(feas), assessGoalFeasibility(feas));
});

// --- bike strategy stub throws everywhere ---

test('bikeStrategy stub throws "not yet implemented" from every method', () => {
  const msg = /bike strategy not yet implemented/;
  assert.throws(() => bikeStrategy.resolveFitnessAnchor({}), msg);
  assert.throws(() => bikeStrategy.resolveZones({}), msg);
  assert.throws(() => bikeStrategy.buildQualitySegments(6, 'threshold', zones, 3, 1.5, 0), msg);
  assert.throws(() => bikeStrategy.buildQualityDescription(6, 'threshold', zones, 3, 1.5, 0), msg);
  assert.throws(
    () =>
      bikeStrategy.assessGoalFeasibility({
        currentVdot: 50,
        goalVdot: 55,
        weeksToRace: 16,
        goalDistanceMeters: 42195,
      }),
    msg,
  );
});

test('generatePlan with discipline="bike" throws (stub not implemented)', () => {
  assert.throws(
    () => generatePlan({ ...planInput, discipline: 'bike' }, zones),
    /bike strategy not yet implemented/,
  );
});
