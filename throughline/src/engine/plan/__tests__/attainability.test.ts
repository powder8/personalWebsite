import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAttainability,
  ageDeclineFactor,
  headroomFraction,
  pbRecencyWeight,
} from '../attainabilityLogic';

// ── Age decline ──────────────────────────────────────────────────────────────
test('age decline: 1.0 at/below peak, monotonically falling after, steeper past 60', () => {
  assert.equal(ageDeclineFactor('run', 25), 1);
  assert.ok(ageDeclineFactor('run', 40) < 1);
  assert.ok(ageDeclineFactor('run', 55) < ageDeclineFactor('run', 40));
  const slope5059 = ageDeclineFactor('bike', 50) - ageDeclineFactor('bike', 59);
  const slope6069 = ageDeclineFactor('bike', 60) - ageDeclineFactor('bike', 69);
  assert.ok(slope6069 > slope5059, 'decline accelerates past 60');
});
test('swim holds better than power with age', () => {
  assert.ok(ageDeclineFactor('swim', 55) > ageDeclineFactor('bike', 55));
});

// ── Headroom ─────────────────────────────────────────────────────────────────
test('headroom shrinks with age', () => {
  assert.ok(headroomFraction('bike', 30) > headroomFraction('bike', 52));
  assert.ok(headroomFraction('bike', 52) > 0);
});

// ── PB recency ───────────────────────────────────────────────────────────────
test('recent PB counts fully; a long-ago one barely', () => {
  assert.equal(pbRecencyWeight(0), 1);
  assert.ok(pbRecencyWeight(2) > 0.8);
  assert.equal(pbRecencyWeight(20), 0.15); // floored
});

// ── The composite ceiling ────────────────────────────────────────────────────
test("a 52yo's bike ceiling sits well below a +33% target (the 4:30 case)", () => {
  const a = assessAttainability({ discipline: 'bike', currentAnchor: 240, ageYears: 52, massKg: 74 });
  // Best-case ~+10% headroom → ~265 W, far below the 319 W a sub-4:30 needs.
  assert.ok(a.ceiling < 300, `ceiling ${a.ceiling} should be < 300`);
  assert.ok(a.ceiling > 240, 'ceiling is above current (some headroom)');
  assert.equal(a.limitedBy, 'headroom');
});

test('a younger athlete has a higher ceiling for the same current fitness', () => {
  const young = assessAttainability({ discipline: 'bike', currentAnchor: 240, ageYears: 28, massKg: 74 });
  const old = assessAttainability({ discipline: 'bike', currentAnchor: 240, ageYears: 55, massKg: 74 });
  assert.ok(young.ceiling > old.ceiling);
});

test('a recent PB raises the ceiling; a decades-old one barely moves it', () => {
  const base = { discipline: 'bike' as const, currentAnchor: 240, ageYears: 45, massKg: 74 };
  const noPb = assessAttainability(base).ceiling;
  const recentPb = assessAttainability({ ...base, personalBest: { anchor: 285, ageAtPB: 43 } }).ceiling;
  const oldPb = assessAttainability({ ...base, personalBest: { anchor: 285, ageAtPB: 27 } }).ceiling;
  assert.ok(recentPb > noPb, 'recent PB lifts the ceiling');
  assert.ok(recentPb > oldPb, 'recent PB lifts more than an old one');
  assert.ok(oldPb >= noPb, 'even a discounted old PB never lowers it');
});

test('the age-graded bounding box caps an implausibly high PB claim', () => {
  // A wildly high (near-WR) PB claim can't push the ceiling past near-elite-for-age.
  const a = assessAttainability({
    discipline: 'run',
    currentAnchor: 45,
    ageYears: 50,
    personalBest: { anchor: 200, ageAtPB: 49 }, // absurd VDOT
  });
  assert.equal(a.limitedBy, 'age_bounding_box');
  assert.ok(a.ceiling <= a.boundingBox + 1e-9);
  assert.ok(a.ceiling < 80, 'capped below the peak-age elite reference');
});
