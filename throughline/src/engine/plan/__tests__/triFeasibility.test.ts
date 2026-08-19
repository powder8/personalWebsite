import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAnchorFeasibility,
  assessTriFeasibility,
  assessFtpGoal,
  assessBikeRaceGoal,
  typicalWeeklyFtpGain,
  typicalWeeklyCssGain,
} from '../triFeasibilityLogic';
import { decomposeGoalTime, legReferenceTimes, type TriAnchors } from '../triGoalTimeLogic';

const ANCHORS: TriAnchors = { run: 48, bike: 240, swim: 1.3 };
const MASS = 75;

// ── Gain curves ──────────────────────────────────────────────────────────────
test('FTP gain diminishes as FTP rises', () => {
  assert.ok(typicalWeeklyFtpGain(200) > typicalWeeklyFtpGain(320));
  assert.ok(typicalWeeklyFtpGain(240) > 0.5 && typicalWeeklyFtpGain(240) < 5);
});
test('CSS gain diminishes as CSS rises and stays positive', () => {
  assert.ok(typicalWeeklyCssGain(1.0) > typicalWeeklyCssGain(1.5));
  assert.ok(typicalWeeklyCssGain(1.8) >= 0.004);
});

// ── Generic anchor core ──────────────────────────────────────────────────────
test('anchor core: goal at or below current → ahead, projected time ≈ current-fitness time', () => {
  const project = (a: number) => Math.round(100000 / a); // toy monotone projector
  const af = assessAnchorFeasibility({
    currentAnchor: 240,
    goalAnchor: 220,
    weeksToRace: 20,
    taperWeeks: 2,
    weeklyGain: 2,
    seasonGainCap: 36,
    projectTime: project,
  });
  assert.equal(af.verdict, 'ahead');
  assert.ok(af.gap < 0);
});
test('anchor core: reachable gap → on_track; far gap → unrealistic', () => {
  const project = (a: number) => Math.round(100000 / a);
  const base = { currentAnchor: 240, weeksToRace: 20, taperWeeks: 2, weeklyGain: 2, seasonGainCap: 36, projectTime: project };
  // 18 trainable weeks × 2 = 36 achievable.
  assert.equal(assessAnchorFeasibility({ ...base, goalAnchor: 270 }).verdict, 'on_track'); // gap 30 ≤ 36
  assert.equal(assessAnchorFeasibility({ ...base, goalAnchor: 285 }).verdict, 'stretch'); // gap 45 ≤ 46.8
  assert.equal(assessAnchorFeasibility({ ...base, goalAnchor: 400 }).verdict, 'unrealistic');
});
test('anchor core: projectedAnchor = current + achievable, capped by the season', () => {
  const af = assessAnchorFeasibility({
    currentAnchor: 240, goalAnchor: 999, weeksToRace: 100, taperWeeks: 2,
    weeklyGain: 2, seasonGainCap: 20, projectTime: (a) => a,
  });
  assert.equal(af.achievableGain, 20); // capped
  assert.equal(af.projectedAnchor, 260);
});

// ── Tri aggregate (G4) ───────────────────────────────────────────────────────
function decompFor(finishSeconds: number) {
  return decomposeGoalTime({ distance: '70.3', targetFinishSeconds: finishSeconds, anchors: ANCHORS, riderMassKg: MASS });
}

test('aggregate: an easy finish (slower than race-today) → all legs ahead, realistic ≤ target', () => {
  const ref = legReferenceTimes('70.3', ANCHORS, MASS);
  const easy = ref.totalSeconds + 3600; // an hour slower than current fitness
  const f = assessTriFeasibility({ decomposition: decompFor(easy + 300), currentAnchors: ANCHORS, weeksToRace: 20, riderMassKg: MASS });
  assert.equal(f.verdict, 'ahead');
  for (const d of ['swim', 'bike', 'run'] as const) assert.equal(f.legs[d].verdict, 'ahead');
  assert.ok(f.realisticFinishSeconds <= f.targetFinishSeconds);
});

test('aggregate: realistic finish = Σ projected legs + transitions', () => {
  const f = assessTriFeasibility({ decomposition: decompFor(5 * 3600), currentAnchors: ANCHORS, weeksToRace: 16, riderMassKg: MASS });
  const sum = f.legs.swim.projectedTimeSeconds + f.legs.bike.projectedTimeSeconds + f.legs.run.projectedTimeSeconds + f.transitionSeconds;
  assert.equal(f.realisticFinishSeconds, sum);
});

test('aggregate: binding leg is the one demanding the biggest fitness jump', () => {
  // A very fast target forces every leg to improve; the binding leg is whichever
  // is furthest from what a normal build yields. Assert it is a real leg and its
  // verdict is the overall verdict.
  const ref = legReferenceTimes('70.3', ANCHORS, MASS);
  const hard = Math.round(ref.totalSeconds * 0.8); // 20% faster everywhere — aggressive
  const f = assessTriFeasibility({ decomposition: decompFor(hard), currentAnchors: ANCHORS, weeksToRace: 12, riderMassKg: MASS });
  assert.ok(['swim', 'bike', 'run'].includes(f.bindingLeg));
  assert.equal(f.verdict, f.legs[f.bindingLeg].verdict);
  // The binding leg should not be "ahead" when the overall target is aggressive.
  assert.notEqual(f.verdict, 'ahead');
});

test('strength-relative split accommodates a weakness: a weak swimmer gets a bigger swim-time share', () => {
  // Same target + bike/run; only the swim anchor differs. The weaker swimmer's
  // reference swim is slower, so the split gives them MORE of the clock for the
  // swim — the plan meets them where they are, rather than demanding they swim
  // like a strong swimmer. (This is why a weak leg isn't automatically binding.)
  const target = 5 * 3600 + 30 * 60;
  const weak = decomposeGoalTime({ distance: '70.3', targetFinishSeconds: target, anchors: { run: 50, bike: 260, swim: 0.95 }, riderMassKg: MASS });
  const strong = decomposeGoalTime({ distance: '70.3', targetFinishSeconds: target, anchors: { run: 50, bike: 260, swim: 1.55 }, riderMassKg: MASS });
  assert.ok(weak.legs.swim.targetSeconds > strong.legs.swim.targetSeconds, 'weak swimmer should get more swim time');
});

test('aggregate: chasing more speed everywhere, the bike tends to bind (aero cost of speed)', () => {
  // A uniformly aggressive target forces every leg ~faster; going faster on the
  // bike costs cubically (aero), so the required FTP jump is the fitness-expensive
  // one. Assert the binding leg is not the swim here.
  const ref = legReferenceTimes('70.3', ANCHORS, MASS);
  const f = assessTriFeasibility({ decomposition: decompFor(Math.round(ref.totalSeconds * 0.85)), currentAnchors: ANCHORS, weeksToRace: 12, riderMassKg: MASS });
  assert.notEqual(f.verdict, 'ahead');
  assert.ok(f.bindingLeg === 'bike' || f.bindingLeg === 'run', `expected bike/run to bind, got ${f.bindingLeg}`);
});

// ── Attainability ceiling (age) + hours scaling ──────────────────────────────

test('ceiling: a 52yo chasing sub-4:30 → bike is beyond_reach (above the age ceiling)', () => {
  const g = decompFor(4 * 3600 + 30 * 60); // sub-4:30 → bike needs ~+33%
  const withAge = assessTriFeasibility({ decomposition: g, currentAnchors: ANCHORS, weeksToRace: 44, riderMassKg: MASS, ageYears: 52, weeklyHours: 8 });
  assert.equal(withAge.bindingLeg, 'bike');
  assert.equal(withAge.verdict, 'beyond_reach');
  assert.equal(withAge.legs.bike.aboveCeiling, true);
  assert.ok(withAge.legs.bike.ceiling! < g.legs.bike.requiredAnchor, 'ceiling below the required FTP');
  assert.match(withAge.note, /elite|attainable|beyond/i);
});

test('ceiling: WITHOUT age, the same target is trajectory-only (no beyond_reach)', () => {
  const g = decompFor(4 * 3600 + 30 * 60);
  const noAge = assessTriFeasibility({ decomposition: g, currentAnchors: ANCHORS, weeksToRace: 44, riderMassKg: MASS });
  assert.notEqual(noAge.verdict, 'beyond_reach');
  assert.equal(noAge.legs.bike.ceiling, undefined);
});

test('hours scaling: fewer training hours never makes a goal look easier', () => {
  const g = decompFor(4 * 3600 + 50 * 60);
  const rank = { ahead: 0, on_track: 1, stretch: 2, unrealistic: 3, beyond_reach: 4 } as const;
  const many = assessTriFeasibility({ decomposition: g, currentAnchors: ANCHORS, weeksToRace: 30, riderMassKg: MASS, weeklyHours: 14 });
  const few = assessTriFeasibility({ decomposition: g, currentAnchors: ANCHORS, weeksToRace: 30, riderMassKg: MASS, weeklyHours: 5 });
  assert.ok(rank[few.legs.bike.verdict] >= rank[many.legs.bike.verdict], 'fewer hours ⇒ same-or-harder bike verdict');
});

// ── Standalone cycling FTP goal ──────────────────────────────────────────────

test('FTP goal: a modest bump is on_track; projected rises above current', () => {
  const g = assessFtpGoal({ currentFtp: 240, targetFtp: 258, weeksToRace: 20, weeklyHours: 8 });
  assert.equal(g.verdict, 'on_track');
  assert.ok(g.projectedFtp > 240); // realistic FTP climbs (may even exceed a modest goal)
  assert.equal(g.gapWatts, 18);
  assert.ok(g.requiredWeeklyGain > 0);
});

test('FTP goal: a target at/below current reads ahead', () => {
  assert.equal(assessFtpGoal({ currentFtp: 260, targetFtp: 250, weeksToRace: 16 }).verdict, 'ahead');
});

test('FTP goal: a 52yo chasing a huge FTP jump is beyond_reach (age ceiling)', () => {
  const g = assessFtpGoal({ currentFtp: 240, targetFtp: 330, weeksToRace: 40, ageYears: 52, massKg: 74, weeklyHours: 8 });
  assert.equal(g.verdict, 'beyond_reach');
  assert.equal(g.aboveCeiling, true);
  assert.ok(g.ceiling! < 330);
});

test('FTP goal: WITHOUT age there is no ceiling, so a big jump is "longer game" not beyond_reach', () => {
  const g = assessFtpGoal({ currentFtp: 240, targetFtp: 330, weeksToRace: 40, weeklyHours: 8 });
  assert.notEqual(g.verdict, 'beyond_reach');
  assert.equal(g.ceiling, undefined);
});

// ── Standalone cycling RACE finish-time (distance + elevation) ───────────────

test('bike race: a generous time on a course → ahead; realistic finish beats target', () => {
  // Required FTP for the target is at/below current → ahead.
  const g = assessBikeRaceGoal({ currentFtp: 260, targetTimeSeconds: 4 * 3600, distanceMeters: 90000, elevationGainMeters: 1000, riderMassKg: MASS, weeksToRace: 16 });
  assert.equal(g.verdict, 'ahead');
  assert.ok(g.requiredFtp <= 260);
  assert.ok(g.projectedTimeSeconds <= 4 * 3600, 'realistic finish beats a generous target');
});

test('bike race: the SAME target time on a hillier course demands more FTP', () => {
  const base = { currentFtp: 240, targetTimeSeconds: 3 * 3600 + 15 * 60, distanceMeters: 90000, riderMassKg: MASS, weeksToRace: 20 };
  const flat = assessBikeRaceGoal({ ...base, elevationGainMeters: 300 });
  const hilly = assessBikeRaceGoal({ ...base, elevationGainMeters: 2500 });
  assert.ok(hilly.requiredFtp > flat.requiredFtp, `hilly needs more W (${hilly.requiredFtp} vs ${flat.requiredFtp})`);
});

test('bike race: a very fast time for a 52yo is beyond_reach (age ceiling)', () => {
  const g = assessBikeRaceGoal({ currentFtp: 240, targetTimeSeconds: 2 * 3600 + 20 * 60, distanceMeters: 90000, elevationGainMeters: 1500, riderMassKg: MASS, weeksToRace: 40, ageYears: 52 });
  assert.equal(g.verdict, 'beyond_reach');
  assert.equal(g.aboveCeiling, true);
});

test('aggregate: prose names the binding leg and both clocks', () => {
  const ref = legReferenceTimes('70.3', ANCHORS, MASS);
  const f = assessTriFeasibility({ decomposition: decompFor(Math.round(ref.totalSeconds * 0.82)), currentAnchors: ANCHORS, weeksToRace: 12, riderMassKg: MASS });
  assert.match(f.note, new RegExp(f.bindingLeg));
  assert.ok(f.headline.length > 0);
});
