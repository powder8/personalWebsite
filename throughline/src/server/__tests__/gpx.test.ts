import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpxRoute } from '@/lib/gpx';

// Four points due north (0.01° lat apart ≈ 1112 m each) with a descent in the
// middle, so total ascent (100→150, then 120→200) is 50 + 80 = 130 m.
const GPX = `<?xml version="1.0"?>
<gpx><trk><name>Test Route</name><trkseg>
<trkpt lat="45.00" lon="7.0"><ele>100</ele></trkpt>
<trkpt lat="45.01" lon="7.0"><ele>150</ele></trkpt>
<trkpt lat="45.02" lon="7.0"><ele>120</ele></trkpt>
<trkpt lat="45.03" lon="7.0"><ele>200</ele></trkpt>
</trkseg></trk></gpx>`;

test('parses distance (haversine) and total ascent from a GPX', () => {
  const r = parseGpxRoute(GPX)!;
  assert.equal(r.pointCount, 4);
  assert.equal(r.name, 'Test Route');
  assert.ok(Math.abs(r.distanceMeters - 3336) < 40, `distance ${r.distanceMeters} ≈ 3336 m`);
  assert.equal(r.elevationGainMeters, 130); // descent doesn't count; only the two climbs
});

test('a small dip within the noise floor does not reset the climb (no under/over-count)', () => {
  // Smooth climb 100→101→104 with a 0.5 m jitter dip — total ascent should be ~4 m.
  const gpx = `<gpx><trkseg>
    <trkpt lat="45.0" lon="7.0"><ele>100</ele></trkpt>
    <trkpt lat="45.001" lon="7.0"><ele>101</ele></trkpt>
    <trkpt lat="45.002" lon="7.0"><ele>100.5</ele></trkpt>
    <trkpt lat="45.003" lon="7.0"><ele>104</ele></trkpt>
  </trkseg></gpx>`;
  const r = parseGpxRoute(gpx)!;
  assert.equal(r.elevationGainMeters, 4); // 100→101 (1) + 101→104 (3); the 0.5 m dip is ignored
});

test('handles rtept (route points) and attribute order lon-before-lat', () => {
  const gpx = `<gpx><rte>
    <rtept lon="7.0" lat="45.0"><ele>10</ele></rtept>
    <rtept lon="7.0" lat="45.01"><ele>60</ele></rtept>
  </rte></gpx>`;
  const r = parseGpxRoute(gpx)!;
  assert.equal(r.pointCount, 2);
  assert.equal(r.elevationGainMeters, 50);
  assert.ok(r.distanceMeters > 1000);
});

test('too few points / garbage → null', () => {
  assert.equal(parseGpxRoute('<gpx></gpx>'), null);
  assert.equal(parseGpxRoute('not xml'), null);
  assert.equal(parseGpxRoute('<gpx><trkpt lat="1" lon="1"/></gpx>'), null); // single point
});

test('a route with no <ele> still yields distance, zero ascent', () => {
  const gpx = `<gpx><trkseg>
    <trkpt lat="45.0" lon="7.0"/>
    <trkpt lat="45.02" lon="7.0"/>
  </trkseg></gpx>`;
  const r = parseGpxRoute(gpx)!;
  assert.equal(r.elevationGainMeters, 0);
  assert.ok(r.distanceMeters > 2000);
});
