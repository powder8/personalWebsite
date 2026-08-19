import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRI_DISTANCE_METERS,
  DEFAULT_TRANSITIONS,
  DEFAULT_RACE_INTENSITY,
  predictSwimSeconds,
  predictBikeSeconds,
  predictRunSeconds,
  bikePowerForSpeed,
  bikeSpeedForPower,
  legReferenceTimes,
  decomposeGoalTime,
  predictBikeTimeOnCourse,
  requiredFtpForBikeTime,
  bikeRaceIntensity,
  DEFAULT_BIKE_COURSE,
  type TriAnchors,
} from '../triGoalTimeLogic';

const ANCHORS: TriAnchors = { run: 48, bike: 240, swim: 1.3 };
const MASS = 75;

// ── Swim predictor ───────────────────────────────────────────────────────────
test('swim: time = distance / (fraction · CSS)', () => {
  // 1900 m at 0.90 · 1.30 m/s = 1.17 m/s → 1624 s
  assert.equal(predictSwimSeconds(1.3, 1900, 0.9), 1624);
});
test('swim: zero/invalid inputs → 0', () => {
  assert.equal(predictSwimSeconds(0, 1900, 0.9), 0);
  assert.equal(predictSwimSeconds(1.3, 0, 0.9), 0);
});

// ── Bike power model ─────────────────────────────────────────────────────────
test('bike power model is monotonic increasing in speed', () => {
  let prev = -1;
  for (let v = 1; v <= 15; v++) {
    const p = bikePowerForSpeed(v, MASS, DEFAULT_BIKE_COURSE);
    assert.ok(p > prev, `power should rise with speed at v=${v}`);
    prev = p;
  }
});
test('bike speed↔power invert cleanly (round-trip within 1 W)', () => {
  for (const watts of [120, 192, 260, 330]) {
    const v = bikeSpeedForPower(watts, MASS, DEFAULT_BIKE_COURSE);
    const back = bikePowerForSpeed(v, MASS, DEFAULT_BIKE_COURSE);
    assert.ok(Math.abs(back - watts) < 1, `round-trip watts ${watts} → ${back}`);
  }
});
test('bike: a 240 W FTP @ IF 0.80 rides 90 km in a plausible 70.3 window (2:15-3:15)', () => {
  const s = predictBikeSeconds(240, MASS, 90000, 0.8);
  assert.ok(s > 8100 && s < 11700, `bike seconds ${s} out of plausible band`);
});
test('bike: more watts → less time', () => {
  const slow = predictBikeSeconds(200, MASS, 90000, 0.8);
  const fast = predictBikeSeconds(300, MASS, 90000, 0.8);
  assert.ok(fast < slow);
});

// ── Bike course model (elevation-aware) ──────────────────────────────────────
test('a hilly course is slower than a flat one of the same distance', () => {
  const flat = predictBikeTimeOnCourse(240, MASS, 100000, 200, 0.8); // ~flat 100 km
  const hilly = predictBikeTimeOnCourse(240, MASS, 100000, 2000, 0.8); // +2000 m climbing
  assert.ok(hilly > flat, `hilly ${hilly} should exceed flat ${flat}`);
  assert.ok(hilly - flat > 600, 'meaningful elevation penalty (>10 min for 2000 m)');
});
test('more FTP → less time on the same course', () => {
  const slow = predictBikeTimeOnCourse(200, MASS, 100000, 1500, 0.8);
  const fast = predictBikeTimeOnCourse(300, MASS, 100000, 1500, 0.8);
  assert.ok(fast < slow);
});
test('requiredFtpForBikeTime inverts the course model (round-trip within a few minutes)', () => {
  const target = 3 * 3600; // 3:00 for the course
  const ftp = requiredFtpForBikeTime(target, MASS, 90000, 1200, 0.8);
  const back = predictBikeTimeOnCourse(ftp, MASS, 90000, 1200, 0.8);
  assert.ok(Math.abs(back - target) < 120, `round-trip ${back} vs ${target}`);
});
test('bikeRaceIntensity falls with duration (a TT holds more than a fondo)', () => {
  assert.ok(bikeRaceIntensity(45 * 60) > bikeRaceIntensity(3 * 3600));
});

// ── Run predictor ────────────────────────────────────────────────────────────
test('run brick factor slows the leg vs a fresh (factor 1) run', () => {
  const fresh = predictRunSeconds(48, 21097.5, 1.0);
  const brick = predictRunSeconds(48, 21097.5, 1.05);
  assert.ok(brick > fresh);
  assert.ok(Math.abs(brick / fresh - 1.05) < 0.01);
});

// ── Reference-time bundle ────────────────────────────────────────────────────
test('legReferenceTimes total = sum of the three legs', () => {
  const ref = legReferenceTimes('70.3', ANCHORS, MASS);
  assert.equal(ref.totalSeconds, ref.swimSeconds + ref.bikeSeconds + ref.runSeconds);
  assert.ok(ref.bikeSeconds > ref.runSeconds && ref.runSeconds > ref.swimSeconds, 'bike > run > swim for a 70.3');
});

// ── Decomposition ────────────────────────────────────────────────────────────
test('decompose: legs + transitions reconstruct the finish; moving budget is finish − transitions', () => {
  const finish = 5 * 3600 + 30 * 60; // sub-5:30
  const g = decomposeGoalTime({ distance: '70.3', targetFinishSeconds: finish, anchors: ANCHORS, riderMassKg: MASS });
  const tr = DEFAULT_TRANSITIONS['70.3'];
  assert.equal(g.transitionSeconds, tr.t1Seconds + tr.t2Seconds);
  assert.equal(g.movingBudgetSeconds, finish - g.transitionSeconds);
  const legSum = g.legs.swim.targetSeconds + g.legs.bike.targetSeconds + g.legs.run.targetSeconds;
  assert.ok(Math.abs(legSum - g.movingBudgetSeconds) < 1, `leg targets ${legSum} vs budget ${g.movingBudgetSeconds}`);
  assert.equal(g.strategy, 'strength_relative');
});

test('decompose: harder-than-current finish → scale < 1 and a "must get faster" note', () => {
  const ref = legReferenceTimes('70.3', ANCHORS, MASS);
  const easyFinish = ref.totalSeconds + 3600; // an hour slower than current fitness
  const hardFinish = ref.totalSeconds - 1800; // half an hour faster
  assert.ok(decomposeGoalTime({ distance: '70.3', targetFinishSeconds: easyFinish, anchors: ANCHORS, riderMassKg: MASS }).scaleFactor > 1);
  const hard = decomposeGoalTime({ distance: '70.3', targetFinishSeconds: hardFinish, anchors: ANCHORS, riderMassKg: MASS });
  assert.ok(hard.scaleFactor < 1);
  assert.match(hard.notes[0], /faster/);
});

test('INVARIANT: finish = reference total + transitions ⇒ each required anchor ≈ the athlete\'s current anchor', () => {
  const ref = legReferenceTimes('70.3', ANCHORS, MASS);
  const finish = ref.totalSeconds + (DEFAULT_TRANSITIONS['70.3'].t1Seconds + DEFAULT_TRANSITIONS['70.3'].t2Seconds);
  const g = decomposeGoalTime({ distance: '70.3', targetFinishSeconds: finish, anchors: ANCHORS, riderMassKg: MASS });
  assert.ok(Math.abs(g.scaleFactor - 1) < 0.001, `scale ${g.scaleFactor} should be ~1`);
  assert.ok(Math.abs(g.legs.swim.requiredAnchor - ANCHORS.swim) < 0.02, `swim CSS ${g.legs.swim.requiredAnchor} vs ${ANCHORS.swim}`);
  assert.ok(Math.abs(g.legs.bike.requiredAnchor - ANCHORS.bike) < 3, `bike FTP ${g.legs.bike.requiredAnchor} vs ${ANCHORS.bike}`);
  assert.ok(Math.abs(g.legs.run.requiredAnchor - ANCHORS.run) < 0.5, `run VDOT ${g.legs.run.requiredAnchor} vs ${ANCHORS.run}`);
});

test('decompose: missing an anchor → typical-split fallback, shares sum to the moving budget', () => {
  const g = decomposeGoalTime({
    distance: '70.3',
    targetFinishSeconds: 5 * 3600 + 30 * 60,
    anchors: { run: 48, bike: 0, swim: 1.3 }, // no FTP
    riderMassKg: MASS,
  });
  assert.equal(g.strategy, 'typical_split');
  const legSum = g.legs.swim.targetSeconds + g.legs.bike.targetSeconds + g.legs.run.targetSeconds;
  assert.ok(Math.abs(legSum - g.movingBudgetSeconds) < 1);
});

test('decompose: leg targets carry native-unit prescriptions', () => {
  const g = decomposeGoalTime({ distance: '70.3', targetFinishSeconds: 5 * 3600 + 30 * 60, anchors: ANCHORS, riderMassKg: MASS });
  assert.ok(g.legs.swim.targetPaceSecPer100 && g.legs.swim.targetPaceSecPer100 > 60);
  assert.ok(g.legs.bike.targetWatts && g.legs.bike.targetWatts > 100);
  assert.ok(g.legs.bike.targetIF && g.legs.bike.targetIF > 0.5);
  assert.ok(g.legs.run.targetPaceSecPerKm && g.legs.run.targetPaceSecPerKm > 180);
});

test('distance table is the canonical 70.3 (1.9 / 90 / 21.1 km)', () => {
  assert.deepEqual(TRI_DISTANCE_METERS['70.3'], { swimMeters: 1900, bikeMeters: 90000, runMeters: 21097.5 });
  assert.ok(DEFAULT_RACE_INTENSITY['70.3'].bikeIntensityFactor === 0.8);
});
