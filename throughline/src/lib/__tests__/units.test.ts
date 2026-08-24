import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDistance, fmtPace, fmtPaceClock, distanceValue, asUnits, distanceUnit, paceUnit } from '../units';

test('distance formats in the chosen unit', () => {
  // 8046.72 m = 5.0 mi = 8.05 km
  assert.equal(fmtDistance(8046.72, 'mi'), '5.0 mi');
  assert.equal(fmtDistance(8046.72, 'km'), '8.0 km');
  assert.ok(Math.abs(distanceValue(1609.344, 'mi') - 1) < 1e-9);
  assert.ok(Math.abs(distanceValue(1000, 'km') - 1) < 1e-9);
});

test('pace converts sec/km into the chosen unit with the right suffix', () => {
  // 5:00/km = 8:03/mi (×1.609)
  assert.equal(fmtPaceClock(300, 'km'), '5:00');
  assert.equal(fmtPaceClock(300, 'mi'), '8:03');
  assert.equal(fmtPace(300, 'km'), '5:00/km');
  assert.equal(fmtPace(300, 'mi'), '8:03/mi');
});

test('labels + asUnits guard', () => {
  assert.equal(distanceUnit('km'), 'km');
  assert.equal(paceUnit('mi'), '/mi');
  assert.equal(asUnits('km'), 'km');
  assert.equal(asUnits('nonsense'), 'mi');
  assert.equal(asUnits(null), 'mi');
});
