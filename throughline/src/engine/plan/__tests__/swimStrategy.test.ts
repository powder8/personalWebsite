import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectStrategy,
  swimStrategy,
  resolveCss,
  resolveSwimZones,
  buildSwimQualitySegments,
  buildSwimQualityDescription,
  buildSwimZones,
  buildPowerZones,
} from '../index';

// --- selection ---------------------------------------------------------------

test("selectStrategy('swim') returns the swim strategy; discipline tag is correct", () => {
  assert.equal(selectStrategy('swim'), swimStrategy);
  assert.equal(swimStrategy.discipline, 'swim');
});

// --- anchor + zones are wired and delegate to cssLogic -----------------------

test('swimStrategy anchor + zones delegate to cssLogic', () => {
  assert.equal(swimStrategy.resolveFitnessAnchor({ cssMetersPerSec: 1.25 }), resolveCss({ cssMetersPerSec: 1.25 }));
  assert.deepEqual(swimStrategy.resolveZones({ cssMetersPerSec: 1.25 }), resolveSwimZones({ cssMetersPerSec: 1.25 }));
  // Anchor from a raw test resolves too.
  assert.equal(
    swimStrategy.resolveFitnessAnchor({ swimTest: { kind: 'css_400_200', t400Sec: 300, t200Sec: 140 } }),
    resolveCss({ swimTest: { kind: 'css_400_200', t400Sec: 300, t200Sec: 140 } }),
  );
  // No anchor at all → the zone resolver throws (its own message, not the stub).
  assert.throws(() => swimStrategy.resolveZones({}), /no fitness anchor/);
});

// --- quality prescription delegates to swimWorkoutsLogic ---------------------

test('swimStrategy prescription delegates to swimWorkoutsLogic (metres seam)', () => {
  const sz = buildSwimZones(1.25);
  // Swim seam speaks METRES: 2000 m day, ~1000 m work, 300 m warm-up/cool-down.
  assert.deepEqual(
    swimStrategy.buildQualitySegments(2000, 'threshold', sz, 1000, 300, 0),
    buildSwimQualitySegments(2000, 'threshold', sz, 1000, 300, 0),
  );
  assert.equal(
    swimStrategy.buildQualityDescription(2000, 'threshold', sz, 1000, 300, 0),
    buildSwimQualityDescription(2000, 'threshold', sz, 1000, 300, 0),
  );
  // A real structured session: warm-up → work → cool-down, pace targets attached.
  const segs = swimStrategy.buildQualitySegments(2000, 'threshold', sz, 1000, 300, 0);
  assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'cooldown']);
  assert.ok((segs[1].targetFastSecPer100 ?? 0) > 0);
});

test('swimStrategy prescription rejects the wrong discipline arm (power zones)', () => {
  const pz = buildPowerZones(250); // PowerZones, not SwimZones
  assert.throws(() => swimStrategy.buildQualitySegments(2000, 'threshold', pz, 1000, 300, 0), /swim zones/);
});

// --- feasibility remains a stub ----------------------------------------------

test('swimStrategy feasibility is a "not yet implemented" stub', () => {
  assert.throws(
    () =>
      swimStrategy.assessGoalFeasibility({
        currentVdot: 50,
        goalVdot: 55,
        weeksToRace: 16,
        goalDistanceMeters: 42195,
      }),
    /swim strategy not yet implemented/,
  );
});
