import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBikeQualitySegments,
  buildBikeQualityDescription,
  resolvePowerZones,
} from '../index';
import type { PowerZoneKey, PowerZones } from '../types';

// A power-meter athlete (FTP 250 W) and a no-power athlete (LTHR 165 bpm).
const power: PowerZones = resolvePowerZones({ ftpWatts: 250 });
const hrOnly: PowerZones = resolvePowerZones({ lthrBpm: 165 });

function session(zone: PowerZoneKey, seed: number, dayMin = 75, zones: PowerZones = power) {
  const wuCd = 12;
  const workMin = dayMin - 2 * wuCd;
  return buildBikeQualitySegments(dayMin, zone, zones, workMin, wuCd, seed);
}

const QUALITY_ZONES: PowerZoneKey[] = [
  'tempo',
  'sweetspot',
  'threshold',
  'vo2max',
  'anaerobic',
  'sprint',
];

// --- structure ----------------------------------------------------------------

test('every quality session is warm-up → work → cool-down', () => {
  for (const zone of QUALITY_ZONES) {
    const segs = session(zone, 0);
    assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'cooldown'], zone);
  }
});

test('warm-up ramps endurance with VO2 openers; cool-down is an easy spin', () => {
  const [warmup, , cooldown] = session('threshold', 0);
  assert.equal(warmup.role, 'warmup');
  assert.equal(warmup.zone, 'endurance');
  assert.match(warmup.note ?? '', /openers/i);
  assert.ok((warmup.durationSeconds ?? 0) > 0);
  assert.equal(cooldown.role, 'cooldown');
  assert.equal(cooldown.zone, 'recovery');
  assert.match(cooldown.note ?? '', /easy spin/i);
});

// --- duration × power (not distance × pace) -----------------------------------

test('work segments are duration × %FTP: repSeconds + watt targets, no meters', () => {
  const work = session('threshold', 0).find((s) => s.role === 'work')!;
  assert.ok((work.repSeconds ?? 0) > 0, 'interval length in seconds');
  assert.equal(work.repMeters, undefined, 'no running meters');
  assert.equal(work.distanceMeters, undefined);
  // Watt targets come from the athlete's threshold band (91-105% of 250 W).
  assert.equal(work.targetLoWatts, power.zones!.threshold.loWatts);
  assert.equal(work.targetHiWatts, power.zones!.threshold.hiWatts);
  assert.match(work.note ?? '', /W\b/, 'watt label in note');
});

test('the watt targets are the athlete OWN zones (FTP 250), not fixed numbers', () => {
  const other = resolvePowerZones({ ftpWatts: 300 });
  const a = buildBikeQualitySegments(75, 'threshold', power, 51, 12, 0).find((s) => s.role === 'work')!;
  const b = buildBikeQualitySegments(75, 'threshold', other, 51, 12, 0).find((s) => s.role === 'work')!;
  assert.notEqual(a.targetLoWatts, b.targetLoWatts);
  assert.equal(b.targetLoWatts, other.zones!.threshold.loWatts);
});

// --- concrete spec sessions ---------------------------------------------------

test('threshold library includes the 4×8 min session from the spec', () => {
  const notes = [0, 1, 2].map((s) => session('threshold', s).find((x) => x.role === 'work')!.note ?? '');
  assert.ok(notes.some((n) => /8 min @/.test(n)), `expected a 4×8 min variant, got:\n${notes.join('\n')}`);
});

test('VO2 library includes the 5×3 min session; reps land in a sane range', () => {
  const seed = [0, 1, 2].find((s) => /3 min @/.test(session('vo2max', s).find((x) => x.role === 'work')!.note ?? ''));
  assert.notEqual(seed, undefined, 'a 3-min VO2 variant exists');
  const work = session('vo2max', seed!).find((s) => s.role === 'work')!;
  assert.ok((work.reps ?? 0) >= 4 && (work.reps ?? 0) <= 6, `reps ${work.reps}`);
  assert.equal(work.repSeconds, 180);
  assert.equal(work.restSeconds, 180); // 1:1 recovery
});

test('sweet-spot library includes the 3×12 min session', () => {
  const notes = [0, 1].map((s) => session('sweetspot', s).find((x) => x.role === 'work')!.note ?? '');
  assert.ok(notes.some((n) => /12 min @/.test(n)), notes.join('\n'));
});

test('longer work volume yields more reps (scales with duration)', () => {
  const shortWork = buildBikeQualitySegments(45, 'threshold', power, 24, 10, 0).find((s) => s.role === 'work')!;
  const longWork = buildBikeQualitySegments(90, 'threshold', power, 48, 12, 0).find((s) => s.role === 'work')!;
  assert.ok((longWork.reps ?? 0) >= (shortWork.reps ?? 0));
});

// --- variety + determinism (mirrors workouts.ts) ------------------------------

test('the seed rotates templates (variety week-to-week)', () => {
  const notes = new Set([0, 1, 2, 3].map((s) => session('vo2max', s).find((x) => x.role === 'work')!.note));
  assert.ok(notes.size >= 2, `expected varied VO2 sessions, got ${notes.size}`);
});

test('selection is deterministic for a given seed', () => {
  assert.deepEqual(session('threshold', 2), session('threshold', 2));
});

// --- zones without a template fall back to a continuous block ------------------

test('endurance/recovery (no template) fall back to a single continuous block', () => {
  for (const zone of ['endurance', 'recovery'] as PowerZoneKey[]) {
    const work = session(zone, 0).filter((s) => s.role === 'work');
    assert.equal(work.length, 1, zone);
    assert.ok((work[0].durationSeconds ?? 0) > 0, 'continuous uses durationSeconds');
    assert.equal(work[0].reps, undefined, 'not an interval set');
    assert.match(work[0].note ?? '', /continuous/i);
  }
});

// --- HR-fallback path (no power meter) ----------------------------------------

test('no-power athletes get the SAME structure, prescribed by %LTHR bpm', () => {
  const segs = session('threshold', 0, 75, hrOnly);
  assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'cooldown']);
  const work = segs.find((s) => s.role === 'work')!;
  assert.match(work.note ?? '', /bpm/, 'HR target, not watts');
  assert.equal(work.targetLoWatts, undefined, 'no watt target without a meter');
  assert.equal(work.targetHiWatts, undefined);
});

test('above-threshold HR bands read as unreliable / RPE cues', () => {
  const work = session('vo2max', 0, 75, hrOnly).find((s) => s.role === 'work')!;
  assert.match(work.note ?? '', /RPE|unreliable/i);
});

// --- prose mirror -------------------------------------------------------------

test('description mirrors the session in prose (warm-up, cool-down, a target)', () => {
  const d = buildBikeQualityDescription(75, 'threshold', power, 51, 12, 0);
  assert.match(d, /warm-up/i);
  assert.match(d, /cool-down/i);
  assert.match(d, /W\b/); // a watt target
  assert.match(d, /min total/);
});

test('prose falls back for a template-less zone (endurance)', () => {
  const d = buildBikeQualityDescription(120, 'endurance', power, 96, 12, 0);
  assert.match(d, /min @ .*W/);
});
