import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSwimZones,
  DEFAULT_SWIM_ZONES,
  cssPaceSecPer100,
  isSwimZones,
  isPowerZones,
  isPaceZones,
  formatSecPer100,
  swimPaceLabel,
  buildPowerZones,
  buildZones,
} from '../index';
import type { SwimZoneKey } from '../types';

const ORDER: SwimZoneKey[] = ['recovery', 'aerobic', 'threshold', 'vo2max', 'sprint'];

// CSS = 1.25 m/s → CSS pace = 80.0 s/100 (a round anchor for arithmetic checks).
const CSS = 1.25;

test('cssPaceSecPer100 = 100 / cssMetersPerSec', () => {
  assert.equal(cssPaceSecPer100(1.25), 80);
  assert.equal(cssPaceSecPer100(0), 0); // guarded
});

test('buildSwimZones: each band is CSS pace + its offset; fast <= slow', () => {
  const z = buildSwimZones(CSS);
  assert.equal(z.kind, 'swim');
  assert.equal(z.cssMetersPerSec, CSS);
  assert.equal(z.cssPaceSecPer100, 80);
  for (const k of ORDER) {
    const { loOffset, hiOffset } = DEFAULT_SWIM_ZONES[k];
    assert.equal(z.zones[k].fastSecPer100, 80 + Math.min(loOffset, hiOffset));
    assert.equal(z.zones[k].slowSecPer100, 80 + Math.max(loOffset, hiOffset));
    assert.ok(z.zones[k].fastSecPer100 <= z.zones[k].slowSecPer100);
  }
  // threshold straddles CSS pace; recovery is slowest, sprint fastest.
  assert.ok(z.zones.threshold.fastSecPer100 < 80 && z.zones.threshold.slowSecPer100 > 80);
  assert.equal(z.zones.recovery.slowSecPer100, 100);
  assert.equal(z.zones.sprint.fastSecPer100, 68);
});

test('bands are monotone across the intensity ladder (recovery slowest → sprint fastest)', () => {
  const z = buildSwimZones(CSS);
  const fasts = ORDER.map((k) => z.zones[k].fastSecPer100);
  for (let i = 1; i < fasts.length; i++) {
    assert.ok(fasts[i] < fasts[i - 1], `${ORDER[i]} should be faster than ${ORDER[i - 1]}`);
  }
});

test('strengthBias +1 (sprinter): sprint/vo2max faster, aerobic slower', () => {
  const base = buildSwimZones(CSS);
  const sprinter = buildSwimZones(CSS, { strengthBias: 1 });
  assert.ok(sprinter.zones.sprint.fastSecPer100 < base.zones.sprint.fastSecPer100);
  assert.ok(sprinter.zones.vo2max.fastSecPer100 < base.zones.vo2max.fastSecPer100);
  assert.ok(sprinter.zones.aerobic.fastSecPer100 > base.zones.aerobic.fastSecPer100);
  // threshold (the anchor) is untouched by bias.
  assert.deepEqual(sprinter.zones.threshold, base.zones.threshold);
});

test('strengthBias -1 (diesel) is the mirror image of +1', () => {
  const base = buildSwimZones(CSS);
  const diesel = buildSwimZones(CSS, { strengthBias: -1 });
  assert.ok(diesel.zones.sprint.fastSecPer100 > base.zones.sprint.fastSecPer100);
  assert.ok(diesel.zones.aerobic.fastSecPer100 < base.zones.aerobic.fastSecPer100);
});

test('bandOverrides replace a zone offset before building', () => {
  const z = buildSwimZones(CSS, { bandOverrides: { threshold: { loOffset: -5, hiOffset: +5 } } });
  assert.equal(z.zones.threshold.fastSecPer100, 75);
  assert.equal(z.zones.threshold.slowSecPer100, 85);
});

test('zoneOverrides nudge/replace final sec/100 bounds', () => {
  const z = buildSwimZones(CSS, {
    zoneOverrides: {
      threshold: { fastAdjust: -1, slowAdjust: +1 }, // shift
      sprint: { fastSecPer100: 60 }, // replace outright
    },
  });
  assert.equal(z.zones.threshold.fastSecPer100, 77); // 78 - 1
  assert.equal(z.zones.threshold.slowSecPer100, 83); // 82 + 1
  assert.equal(z.zones.sprint.fastSecPer100, 60);
});

// --- narrowing across the whole TrainingZones union --------------------------

test('isSwimZones narrows only the swim arm; not power, not pace', () => {
  const swim = buildSwimZones(CSS);
  const power = buildPowerZones(250);
  const pace = buildZones(222.5);
  assert.ok(isSwimZones(swim));
  assert.ok(!isSwimZones(power));
  assert.ok(!isSwimZones(pace));
  // and the swim arm is excluded from the pace/power narrows too.
  assert.ok(!isPowerZones(swim));
  assert.ok(!isPaceZones(swim));
  // pace still narrows as pace, power still as power (unchanged behaviour).
  assert.ok(isPaceZones(pace));
  assert.ok(isPowerZones(power));
});

// --- display helpers ---------------------------------------------------------

test('formatSecPer100 renders m:ss', () => {
  assert.equal(formatSecPer100(80), '1:20');
  assert.equal(formatSecPer100(95), '1:35');
  assert.equal(formatSecPer100(5), '0:05');
});

test('swimPaceLabel renders a per-100 range', () => {
  const z = buildSwimZones(CSS);
  assert.equal(swimPaceLabel(z.zones.threshold), '1:18–1:22 /100m');
});
