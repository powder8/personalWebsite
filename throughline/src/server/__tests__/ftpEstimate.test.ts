import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestRollingAvgWatts,
  ftpFromWattsStream,
  pickFtpCandidates,
  combineFtpEstimates,
} from '@/lib/ftpEstimate';

test('bestRollingAvgWatts finds the strongest window (time-weighted)', () => {
  const times = [0, 10, 20, 30, 40];
  const watts = [100, 300, 300, 100, 100];
  // Best 20 s window is [10,30] = (300·10 + 300·10)/20 = 300.
  assert.equal(bestRollingAvgWatts(times, watts, 20), 300);
  // A window longer than the ride → 0 (no full window).
  assert.equal(bestRollingAvgWatts(times, watts, 100), 0);
});

test('bestRollingAvgWatts is robust to gappy (non-1Hz) sampling', () => {
  // A 20 s gap between samples; power 200 held across it.
  const times = [0, 5, 25, 30];
  const watts = [200, 200, 200, 200];
  assert.ok(Math.abs(bestRollingAvgWatts(times, watts, 20) - 200) < 1e-9);
});

test('ftpFromWattsStream = best 20-min power × 0.95', () => {
  const times = Array.from({ length: 1301 }, (_, i) => i); // 0..1300 s at 1 Hz
  const watts = times.map((_, i) => (i < 1200 ? 300 : 100)); // 20 min at 300 W, then easy
  assert.equal(ftpFromWattsStream(times, watts), 285); // round(300 × 0.95)
});

test('ftpFromWattsStream → 0 for a ride shorter than 20 min', () => {
  const times = Array.from({ length: 600 }, (_, i) => i);
  const watts = times.map(() => 300);
  assert.equal(ftpFromWattsStream(times, watts), 0);
});

test('pickFtpCandidates keeps real-power sustained rides, ranks by NP, caps count', () => {
  const rides = [
    { id: 1, durationSeconds: 1800, weightedAvgWatts: 250, deviceWatts: true },
    { id: 2, durationSeconds: 600, weightedAvgWatts: 300, deviceWatts: true }, // too short
    { id: 3, durationSeconds: 3600, weightedAvgWatts: 230, deviceWatts: false }, // estimated power
    { id: 4, durationSeconds: 2400, weightedAvgWatts: 260, deviceWatts: true },
  ];
  const picked = pickFtpCandidates(rides);
  assert.deepEqual(picked.map((r) => r.id), [4, 1]); // NP desc, filtered
});

test('combineFtpEstimates takes the best effort + scales confidence', () => {
  assert.equal(combineFtpEstimates([]), null);
  assert.equal(combineFtpEstimates([0, 0]), null);
  const r = combineFtpEstimates([285, 270, 0, 290])!;
  assert.equal(r.ftpWatts, 290);
  assert.equal(r.confidence, 'high');
  assert.equal(r.sampleSize, 3);
  assert.equal(combineFtpEstimates([250])!.confidence, 'low');
});
