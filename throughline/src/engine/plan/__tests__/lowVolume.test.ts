import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, resolvePaceZones } from '../index';

const MI = 1609.344;
const zones = resolvePaceZones({ race: { distanceMeters: 5000, timeSeconds: 22 * 60 } });

/**
 * The coach sniff test (Peter's bug): a low-volume athlete must never be
 * prescribed micro-runs like 0.3 mi — consolidate into fewer meaningful runs.
 */
function checkPlan(startMiles: number, peakMiles: number) {
  const weeks = generatePlan(
    {
      startDay: '2026-06-15',
      goalRaceDay: '2026-08-08',
      startVolumeMiles: startMiles,
      peakVolumeMiles: peakMiles,
      keyRaces: [],
    },
    zones,
  );
  for (const w of weeks) {
    for (const d of w.days) {
      const miles = (d.distanceMeters ?? 0) / MI;
      if (d.runType === 'rest') continue;
      assert.ok(miles >= 1.9, `${w.weekStart} ${d.runType}: ${miles.toFixed(2)} mi is below the 2 mi floor`);
      // Half-mile granularity — no 0.3-mi oddities.
      assert.ok(Math.abs(miles * 2 - Math.round(miles * 2)) < 0.05, `${miles.toFixed(2)} mi not half-mile rounded`);
      // Quality sessions only when there's room for warm-up + work + cool-down.
      if (d.segments?.length) assert.ok(miles >= 2.9, `structured workout on only ${miles.toFixed(1)} mi`);
    }
    // Consolidation must preserve roughly the intended weekly volume.
    const total = w.days.reduce((s, d) => s + (d.distanceMeters ?? 0), 0) / MI;
    const target = w.targetVolumeMeters / MI;
    assert.ok(Math.abs(total - target) <= Math.max(1.5, target * 0.15), `${w.weekStart}: ${total} vs target ${target}`);
  }
  return weeks;
}

test('very low volume (5→12 mi/wk) consolidates into few meaningful runs', () => {
  const weeks = checkPlan(5, 12);
  // Early weeks at ~5 mi should have only 2-3 runs, not 6 micro-runs.
  const runDays = weeks[0].days.filter((d) => d.runType !== 'rest').length;
  assert.ok(runDays <= 3, `week 1 has ${runDays} run days at ~5 mi/wk`);
});

test('beginner-ish volume (12→25 mi/wk) stays sensible', () => {
  checkPlan(12, 25);
});

test('higher volume (40→60 mi/wk) is unaffected by the floors', () => {
  const weeks = checkPlan(40, 60);
  const runDays = weeks[0].days.filter((d) => d.runType !== 'rest').length;
  assert.ok(runDays >= 5, `high volume should keep most run days (got ${runDays})`);
});
