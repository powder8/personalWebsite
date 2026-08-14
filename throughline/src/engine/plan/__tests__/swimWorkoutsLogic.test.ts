import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSwimQualitySegments,
  buildSwimQualityDescription,
  buildSwimTechniqueSegments,
  buildSwimZones,
  SWIM_DRILLS,
} from '../index';

const z = buildSwimZones(1.25); // CSS pace 80 s/100

test('quality session is warm-up → main set → cool-down', () => {
  const segs = buildSwimQualitySegments(2000, 'threshold', z, 1000, 300, 0);
  assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'cooldown']);
  // warm-up/cool-down are continuous metres at recovery pace.
  assert.equal(segs[0].zone, 'recovery');
  assert.equal(segs[0].distanceMeters, 300);
  assert.equal(segs[2].distanceMeters, 300);
});

test('threshold main set: reps × 100 m @ CSS with rest and pace targets attached', () => {
  const segs = buildSwimQualitySegments(2000, 'threshold', z, 1000, 300, 0); // seed 0 → thr-100s
  const work = segs[1];
  assert.equal(work.role, 'work');
  assert.equal(work.zone, 'threshold');
  assert.equal(work.reps, 10); // 1000 / 100
  assert.equal(work.repMeters, 100);
  assert.equal(work.restSeconds, 15);
  // CSS-relative pace targets come from the athlete's own zones (never absolute).
  assert.equal(work.targetFastSecPer100, z.zones.threshold.fastSecPer100);
  assert.equal(work.targetSlowSecPer100, z.zones.threshold.slowSecPer100);
});

test('seed rotates the threshold template deterministically', () => {
  const a = buildSwimQualitySegments(2000, 'threshold', z, 1200, 300, 0)[1];
  const b = buildSwimQualitySegments(2000, 'threshold', z, 1200, 300, 1)[1];
  // Different templates → different rep distance (100s vs 200s).
  assert.notEqual(a.repMeters, b.repMeters);
  // Deterministic: same seed → same shape.
  const a2 = buildSwimQualitySegments(2000, 'threshold', z, 1200, 300, 0)[1];
  assert.deepEqual(a, a2);
});

test('vo2max and sprint sets sit above CSS and carry their pace targets', () => {
  const vo2 = buildSwimQualitySegments(1500, 'vo2max', z, 800, 200, 0)[1];
  assert.equal(vo2.zone, 'vo2max');
  assert.ok((vo2.targetFastSecPer100 ?? 0) < z.zones.threshold.fastSecPer100); // faster than CSS
  const spr = buildSwimQualitySegments(1000, 'sprint', z, 400, 200, 0)[1];
  assert.equal(spr.zone, 'sprint');
  assert.equal(spr.repMeters, 25); // seed 0 → 25 m sprints
});

test('recovery zone (no template) falls back to a continuous block', () => {
  const segs = buildSwimQualitySegments(1200, 'recovery', z, 800, 200, 0);
  assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'cooldown']);
  const work = segs[1];
  assert.equal(work.distanceMeters, 800); // continuous metres, not reps
  assert.equal(work.reps, undefined);
});

test('prose mirror names the set and totals the session', () => {
  const prose = buildSwimQualityDescription(2000, 'threshold', z, 1000, 300, 0);
  assert.match(prose, /100 m/);
  assert.match(prose, /CSS/);
  assert.match(prose, /2000 m total/);
});

// --- technique / drills: a first-class swim session --------------------------

test('technique session: warm-up → two drill sets → cool-down, prescribed as reps × 50', () => {
  const segs = buildSwimTechniqueSegments(2000, z, 0);
  assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'work', 'cooldown']);
  for (const d of [segs[1], segs[2]]) {
    assert.equal(d.repMeters, 50);
    assert.ok((d.reps ?? 0) >= 1);
    assert.equal(d.zone, 'recovery');
    assert.match(d.note ?? '', /drill/);
  }
  // The two drills differ (variety within the session).
  assert.notEqual(segs[1].note, segs[2].note);
});

test('technique drills rotate deterministically by seed and reference the catalogue', () => {
  const s0 = buildSwimTechniqueSegments(2000, z, 0)[1].note;
  const s1 = buildSwimTechniqueSegments(2000, z, 1)[1].note;
  assert.notEqual(s0, s1);
  assert.deepEqual(buildSwimTechniqueSegments(2000, z, 0)[1], buildSwimTechniqueSegments(2000, z, 0)[1]);
  assert.ok(SWIM_DRILLS.length >= 5);
});
