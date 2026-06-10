import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline } from '@/lib/polyline';
import { normalizeSplits } from '@/providers/strava/index';

test('decodePolyline decodes the canonical Google example', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(pts.length, 3);
  assert.deepEqual(pts[0], [38.5, -120.2]);
  assert.deepEqual(pts[1], [40.7, -120.95]);
  assert.deepEqual(pts[2], [43.252, -126.453]);
});

test('decodePolyline handles empty input', () => {
  assert.deepEqual(decodePolyline(''), []);
});

test('normalizeSplits maps Strava mile splits to our stored shape', () => {
  const splits = normalizeSplits([
    { distance: 1609.3, moving_time: 480, average_speed: 3.35, average_heartrate: 152.6, elevation_difference: 4.2 },
    { distance: 1609.4, moving_time: 470, average_heartrate: 158.2, elevation_difference: -3.1 },
    { distance: 402.1, moving_time: 115 }, // trailing partial mile kept
    { distance: 0, moving_time: 0 }, // junk dropped
  ])!;
  assert.equal(splits.length, 3);
  assert.equal(splits[0].avgHr, 153);
  assert.ok(Math.abs(splits[0].paceSecPerKm! - 298.3) < 0.5);
  assert.equal(splits[1].elevDiffMeters, -3.1);
  assert.equal(splits[2].avgHr, null);
});

test('normalizeSplits returns null when splits are absent (list-based sync)', () => {
  assert.equal(normalizeSplits(undefined), null);
  assert.equal(normalizeSplits([]), null);
});
