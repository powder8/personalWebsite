import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, resolvePaceZones, classifyGoal } from '../index';
import type { GoalClass } from '../raceWindows';

const zones = resolvePaceZones({ race: { distanceMeters: 5000, timeSeconds: 22 * 60 } });

function qualityZonesByPhase(goalClass?: GoalClass) {
  const weeks = generatePlan(
    {
      startDay: '2026-06-15',
      goalRaceDay: '2026-10-04',
      startVolumeMiles: 30,
      peakVolumeMiles: 45,
      keyRaces: [],
      goalClass,
    },
    zones,
  );
  const byPhase = new Map<string, Set<string>>();
  for (const w of weeks) {
    for (const d of w.days) {
      if (d.runType !== 'quality' || !d.zone) continue;
      if (!byPhase.has(w.phase)) byPhase.set(w.phase, new Set());
      byPhase.get(w.phase)!.add(d.zone);
    }
  }
  return byPhase;
}

test('classifyGoal maps distances to Daniels race classes', () => {
  assert.equal(classifyGoal({ date: 'x', distanceMeters: 5000, distanceLabel: '5K' }), 'tenk_or_shorter');
  assert.equal(classifyGoal({ date: 'x', distanceMeters: 21097.5, distanceLabel: 'Half' }), 'half');
  assert.equal(classifyGoal({ date: 'x', distanceMeters: 42195, distanceLabel: 'Marathon' }), 'marathon');
});

test('5K plans sharpen with VO2/rep work at peak — never marathon-pace quality', () => {
  const phases = qualityZonesByPhase('tenk_or_shorter');
  const peak = phases.get('peak') ?? new Set();
  assert.ok(peak.has('interval'), `peak should include interval work (got ${[...peak]})`);
  for (const zones of phases.values()) assert.ok(!zones.has('marathon'), '5K plan prescribed marathon-pace quality');
  const build = phases.get('build') ?? new Set();
  assert.ok(build.has('interval'), 'build should include VO2 intervals');
});

test('marathon plans emphasise M-pace + cruise threshold at peak — no rep work', () => {
  const phases = qualityZonesByPhase('marathon');
  const peak = phases.get('peak') ?? new Set();
  assert.ok(peak.has('marathon'), `peak should include marathon-pace work (got ${[...peak]})`);
  for (const zones of phases.values()) assert.ok(!zones.has('rep'), 'marathon plan prescribed rep work');
});

test('no goal class → legacy template behavior (backwards compatible)', () => {
  const phases = qualityZonesByPhase(undefined);
  const peak = phases.get('peak') ?? new Set();
  assert.ok(peak.has('threshold') && peak.has('marathon'), `legacy peak zones changed: ${[...peak]}`);
});
