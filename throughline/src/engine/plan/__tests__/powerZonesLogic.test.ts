import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPowerZones,
  buildHrZones,
  DEFAULT_POWER_ZONES,
  DEFAULT_HR_ZONES,
  isPowerZones,
  isPaceZones,
  wattsLabel,
  wattsPerKg,
  bpmLabel,
  buildZones,
} from '../index';
import type { PowerZoneKey } from '../types';

const ORDER: PowerZoneKey[] = [
  'recovery',
  'endurance',
  'tempo',
  'sweetspot',
  'threshold',
  'vo2max',
  'anaerobic',
  'sprint',
];

// --- Coggan %FTP model reproduces exact watt boundaries at a known FTP ---

test('buildPowerZones: each band = FTP × its %FTP bounds, at FTP=250', () => {
  const z = buildPowerZones(250);
  assert.equal(z.kind, 'power');
  assert.equal(z.basis, 'ftp');
  for (const k of ORDER) {
    assert.equal(z.zones![k].loWatts, Math.round(250 * DEFAULT_POWER_ZONES[k].lo), `${k} lo`);
    assert.equal(z.zones![k].hiWatts, Math.round(250 * DEFAULT_POWER_ZONES[k].hi), `${k} hi`);
  }
  // Coggan spot checks: 1 h at FTP sits inside threshold; endurance ~56-75%.
  assert.equal(z.zones!.threshold.hiWatts, 263); // 1.05 × 250
  assert.equal(z.zones!.endurance.loWatts, 140); // 0.56 × 250
  assert.equal(z.zones!.endurance.hiWatts, 188); // 0.75 × 250 (rounded)
});

test('buildPowerZones: zones ascend in intensity (recovery < … < sprint)', () => {
  const z = buildPowerZones(250);
  // sweetspot overlaps tempo/threshold by design, so compare the strict tiles.
  const tiling: PowerZoneKey[] = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2max', 'anaerobic', 'sprint'];
  for (let i = 1; i < tiling.length; i++) {
    assert.ok(
      z.zones![tiling[i]].loWatts >= z.zones![tiling[i - 1]].loWatts,
      `${tiling[i]} lo >= ${tiling[i - 1]} lo`,
    );
  }
  // sweetspot really does straddle Z3/Z4 (88-94% FTP).
  assert.equal(z.zones!.sweetspot.loWatts, 220);
  assert.equal(z.zones!.sweetspot.hiWatts, 235);
});

test('buildPowerZones: band overrides and final watt nudges apply', () => {
  const z = buildPowerZones(250, {
    bandOverrides: { threshold: { lo: 0.95, hi: 1.0 } },
    zoneOverrides: { threshold: { hiAdjust: 5 } },
  });
  assert.equal(z.zones!.threshold.loWatts, Math.round(250 * 0.95)); // 238
  assert.equal(z.zones!.threshold.hiWatts, Math.round(250 * 1.0) + 5); // 255
});

test('buildPowerZones: +strength bias lifts the sprint/anaerobic ceiling', () => {
  const neutral = buildPowerZones(250);
  const punchy = buildPowerZones(250, { strengthBias: 1 });
  assert.ok(punchy.zones!.sprint.hiWatts > neutral.zones!.sprint.hiWatts, 'sprinter gets a higher sprint band');
  assert.ok(punchy.zones!.anaerobic.hiWatts > neutral.zones!.anaerobic.hiWatts);
});

test('buildPowerZones: LTHR present → attaches secondary HR bands', () => {
  const z = buildPowerZones(250, { lthrBpm: 170 });
  assert.ok(z.hrZones);
  assert.equal(z.hrZones!.threshold.hiBpm, Math.round(170 * DEFAULT_HR_ZONES.threshold.hi));
});

// --- HR fallback (%LTHR) ---

test('buildHrZones: %LTHR bands at a known LTHR, no watt zones', () => {
  const z = buildHrZones(170);
  assert.equal(z.basis, 'lthr');
  assert.equal(z.ftpWatts, null);
  assert.equal(z.zones, null);
  assert.equal(z.hrZones!.recovery.hiBpm, Math.round(170 * 0.68));
  assert.equal(z.hrZones!.threshold.hiBpm, Math.round(170 * 1.05));
});

// --- narrowing + display ---

test('isPowerZones / isPaceZones narrow the TrainingZones union', () => {
  const power = buildPowerZones(250);
  const pace = buildZones(222.5); // a PaceZones
  assert.ok(isPowerZones(power));
  assert.ok(!isPaceZones(power));
  assert.ok(isPaceZones(pace));
  assert.ok(!isPowerZones(pace));
});

test('display helpers format watts, W/kg and bpm', () => {
  assert.equal(wattsLabel({ loWatts: 250, hiWatts: 290 }), '250-290 W');
  assert.equal(wattsPerKg(280, 70), 4);
  assert.equal(wattsPerKg(280, 0), 0);
  assert.equal(bpmLabel({ loBpm: 150, hiBpm: 160 }), '150-160 bpm');
});
