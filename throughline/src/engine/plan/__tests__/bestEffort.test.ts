import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestSustainedEffort, bestEffortAcross, type EffortSegment } from '@/engine/plan';

const MI = 1609.344;
// A per-mile split at a given pace (min:sec per mile) with an HR.
const mile = (paceSec: number, hr: number | null = null): EffortSegment => ({
  distanceMeters: MI,
  durationSeconds: paceSec,
  avgHr: hr,
});

test('finds a 5K race buried in a longer run (warm-up + race + cool-down, one file)', () => {
  // 2 easy warm-up miles, ~3 mi of 7:35 race effort, 2 easy cool-down miles.
  const splits = [
    mile(9 * 60, 140),
    mile(9 * 60, 142),
    mile(455, 188), // 7:35/mi
    mile(455, 192),
    mile(455, 195),
    mile(9 * 60 + 30, 150),
    mile(9 * 60 + 30, 148),
  ];
  const best = bestSustainedEffort(splits)!;
  assert.ok(best, 'found a sustained effort');
  // The hard 3-mile block (~4.8km) should be the pick, not the slow whole-run avg.
  assert.ok(best.distanceMeters >= 3000 && best.distanceMeters <= 6000);
  assert.ok(best.paceSecPerKm < 300, `pace ${best.paceSecPerKm} should reflect the race miles`);
  assert.ok(best.vdot >= 38, `VDOT ${best.vdot} should reflect the race, not the easy average`);
  assert.ok((best.avgHr ?? 0) >= 185, 'HR over the block reflects the hard effort');
});

test('whole-activity average would badly understate that effort', () => {
  const splits = [mile(9 * 60), mile(9 * 60), mile(455), mile(455), mile(455), mile(570), mile(570)];
  const wholeMeters = splits.reduce((a, s) => a + s.distanceMeters, 0);
  const wholeSec = splits.reduce((a, s) => a + s.durationSeconds, 0);
  const wholePace = (wholeSec / wholeMeters) * 1000;
  const best = bestSustainedEffort(splits)!;
  assert.ok(best.paceSecPerKm < wholePace - 30, 'best effort is meaningfully faster than the whole-run average');
});

test('a steady easy run yields a modest effort (no false peak)', () => {
  const splits = Array.from({ length: 6 }, () => mile(8 * 60, 145));
  const best = bestSustainedEffort(splits)!;
  assert.ok(best.vdot < 45);
  assert.ok(Math.abs(best.paceSecPerKm - (480 / MI) * 1000) < 5);
});

test('returns null when nothing reaches the minimum anchor distance', () => {
  assert.equal(bestSustainedEffort([mile(360)]), null); // ~1.6km < 3km min
  assert.equal(bestSustainedEffort([]), null);
  assert.equal(bestSustainedEffort(null), null);
});

test('respects the max distance (long slow runs do not form an anchor block beyond range)', () => {
  // 20 easy miles — any 3K–half window is easy; VDOT stays modest, distance within range.
  const splits = Array.from({ length: 20 }, () => mile(9 * 60, 150));
  const best = bestSustainedEffort(splits)!;
  assert.ok(best.distanceMeters <= 21100);
});

test('bestEffortAcross prefers the stronger of laps vs splits', () => {
  const splits = [mile(8 * 60), mile(8 * 60), mile(8 * 60)]; // VDOT ~ low-40s? steady 8:00
  // Laps capture a tighter, faster 5K block.
  const laps: EffortSegment[] = [
    { distanceMeters: 5000, durationSeconds: 19 * 60 + 20, avgHr: 190 }, // ~6:13/mi
  ];
  const best = bestEffortAcross(splits, laps)!;
  assert.ok(best.vdot >= 49, `laps 5K should win (VDOT ${best.vdot})`);
  assert.equal(best.avgHr, 190);
});
