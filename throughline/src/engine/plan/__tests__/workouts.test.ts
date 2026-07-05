import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQualitySegments, buildQualityDescription } from '../workouts';
import { resolvePaceZones } from '../index';
import type { ZoneKey } from '../types';

const zones = resolvePaceZones({ race: { distanceMeters: 5000, timeSeconds: 18 * 60 } });

function session(zone: ZoneKey, seed: number, dayMiles = 8) {
  const wuCd = 2;
  const workMiles = dayMiles - 2 * wuCd;
  return buildQualitySegments(dayMiles, zone, zones, workMiles, wuCd, seed);
}

test('every quality session has warm-up, work, and cool-down', () => {
  for (const zone of ['threshold', 'interval', 'rep'] as ZoneKey[]) {
    const segs = session(zone, 0);
    assert.deepEqual(segs.map((s) => s.role), ['warmup', 'work', 'cooldown']);
  }
});

test('warm-up states how long and how fast, plus drills + strides', () => {
  const [warmup] = session('interval', 0);
  assert.match(warmup.note ?? '', /mi easy @ \d/); // distance + pace
  assert.match(warmup.note ?? '', /drills/i);
  assert.match(warmup.note ?? '', /strides/i);
});

test('reps name the length, the athlete pace, and the recovery TYPE', () => {
  const work = session('rep', 0).find((s) => s.role === 'work')!;
  assert.match(work.note ?? '', /×/); // rep count × length
  assert.match(work.note ?? '', /@ \d+:\d/); // an athlete pace, not a bare label
  assert.match(work.note ?? '', /recovery|jog|walk|standing/i); // explicit recovery
});

test('the athlete pace is used — not a hard-coded elite pace', () => {
  // An 18-min 5K runner's rep pace should NOT be Heather's ~4:57/mi.
  const work = session('rep', 0).find((s) => s.role === 'work')!;
  assert.doesNotMatch(work.note ?? '', /4:5\d\/mi/);
});

test('the seed selects different templates (variety)', () => {
  const notes = new Set([0, 1, 2, 3].map((s) => session('threshold', s).find((x) => x.role === 'work')!.note));
  assert.ok(notes.size >= 2, `expected variety across seeds, got ${notes.size}`);
});

test('selection is deterministic for a given seed', () => {
  assert.deepEqual(session('interval', 2), session('interval', 2));
});

test('description mirrors the session in prose', () => {
  const d = buildQualityDescription(8, 'threshold', zones, 4, 2, 0);
  assert.match(d, /warm-up/i);
  assert.match(d, /cool-down/i);
  assert.match(d, /@ \d/); // a pace
});
