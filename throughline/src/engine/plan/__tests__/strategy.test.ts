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
  resolveFtp,
  resolvePowerZones,
  buildBikeQualitySegments,
  buildBikeQualityDescription,
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

// --- bike strategy: anchor + zones are wired (Story 1); the rest still stubs ---

test('bikeStrategy anchor + zones are implemented and delegate to ftpLogic', () => {
  assert.equal(bikeStrategy.resolveFitnessAnchor({ ftpWatts: 250 }), resolveFtp({ ftpWatts: 250 }));
  assert.deepEqual(bikeStrategy.resolveZones({ ftpWatts: 250 }), resolvePowerZones({ ftpWatts: 250 }));
  // No anchor at all → the zone resolver throws (its own message, not the stub).
  assert.throws(() => bikeStrategy.resolveZones({}), /no fitness anchor/);
});

test('bikeStrategy prescription is implemented (Story 4) and delegates to bikeWorkoutsLogic', () => {
  const pz = resolvePowerZones({ ftpWatts: 250 }); // power zones, in watts
  // Bike seam speaks MINUTES: 60 min day, ~40 min work, 10 min warm-up/cool-down.
  assert.deepEqual(
    bikeStrategy.buildQualitySegments(60, 'threshold', pz, 40, 10, 0),
    buildBikeQualitySegments(60, 'threshold', pz, 40, 10, 0),
  );
  assert.equal(
    bikeStrategy.buildQualityDescription(60, 'threshold', pz, 40, 10, 0),
    buildBikeQualityDescription(60, 'threshold', pz, 40, 10, 0),
  );
  // A real structured session: warm-up → work → cool-down, watt targets attached.
  const segs = bikeStrategy.buildQualitySegments(60, 'threshold', pz, 40, 10, 0);
  assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'cooldown']);
  assert.ok((segs[1].targetLoWatts ?? 0) > 0);
});

test('bikeStrategy prescription rejects pace zones (the wrong discipline arm)', () => {
  // `zones` here is PaceZones; the bike arm must not be fed the run zones.
  assert.throws(() => bikeStrategy.buildQualitySegments(60, 'threshold', zones, 40, 10, 0), /power zones/);
});

test('bikeStrategy feasibility remains a "not yet implemented" stub (Story 6)', () => {
  assert.throws(
    () =>
      bikeStrategy.assessGoalFeasibility({
        currentVdot: 50,
        goalVdot: 55,
        weeksToRace: 16,
        goalDistanceMeters: 42195,
      }),
    /bike strategy not yet implemented/,
  );
});

test('generatePlan with discipline="bike" is not yet wired (Story 5) — it takes pace zones', () => {
  // generatePlan still threads a PaceZones fixture; the bike prescription needs
  // power zones, so the cycling path isn't reachable until Story 5 supplies them.
  assert.throws(() => generatePlan({ ...planInput, discipline: 'bike' }, zones), /power zones/);
});
