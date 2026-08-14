import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  periodize,
  generateWeek,
  generatePlan,
  generateSwimWeek,
  metersFromStss,
  durationSecondsFromTss,
  COACH_SWIM_TEMPLATE_SET,
  COACH_TEMPLATE_SET,
  swimStrategy,
  buildSwimZones,
  buildZones,
} from '../index';
import { stss, zoneIf } from '../../loadCurrencyLogic';

const CSS = 1.25; // m/s → CSS pace 80 s/100 m
const swim = buildSwimZones(CSS); // CSS-relative sec/100 m bands

const swimInput = {
  startDay: '2026-01-05',
  goalRaceDay: '2026-06-14',
  startVolumeMiles: 180, // read as weekly sTSS on the swim
  peakVolumeMiles: 320,
  discipline: 'swim' as const,
};

// --- the sTSS→metres kernel (the swim currency conversion) -------------------

test('metersFromStss inverts stss(): the metres price back to the same sTSS', () => {
  const IF = zoneIf('threshold'); // 0.98
  const target = 40;
  const meters = metersFromStss(target, IF, CSS);
  const durationSeconds = durationSecondsFromTss(target, IF);
  // The metres swum at that IF price back (via stss) to the original sTSS.
  const priced = stss({ cssMetersPerSec: CSS, distanceMeters: meters, durationSeconds });
  assert.ok(Math.abs(priced.load - target) < 1e-6, `priced ${priced.load} vs ${target}`);
  // Guards.
  assert.equal(metersFromStss(0, IF, CSS), 0);
  assert.equal(metersFromStss(40, 0, CSS), 0);
  assert.equal(metersFromStss(40, IF, 0), 0);
});

// --- periodize is unit-generic (shared with the bike) ------------------------

test('periodize on sTSS ramps the generic load, not meters', () => {
  const weeks = periodize({ ...swimInput, volumeUnit: 'tss' });
  for (const w of weeks) {
    assert.equal(w.loadUnit, 'tss');
    assert.equal(w.targetVolumeMeters, 0, 'no ramp-meters on the swim');
    assert.ok(w.targetLoad > 0, 'carries an sTSS load');
  }
});

// --- a coherent swim week ----------------------------------------------------

test('generatePlan(swim) returns metre-based weeks: aerobic + quality + technique + long', () => {
  const weeks = generatePlan(swimInput, swim);
  assert.ok(weeks.length > 8);
  const build = weeks.find((w) => w.phase === 'build')!;

  const long = build.days.find((d) => d.runType === 'long')!;
  const quality = build.days.filter((d) => d.runType === 'quality');
  const aerobic = build.days.filter((d) => d.runType === 'easy');
  assert.ok(long, 'has a long swim');
  assert.ok(quality.length >= 1, 'has quality sessions');
  assert.ok(aerobic.length >= 1, 'has aerobic fill');

  // Every non-rest day is metre-based with an sTSS target and a duration.
  for (const d of build.days) {
    if (d.runType === 'rest') {
      assert.equal(d.distanceMeters, 0);
      continue;
    }
    assert.ok(d.distanceMeters > 0, `${d.runType} carries metres`);
    assert.ok((d.durationSeconds ?? 0) > 0, `${d.runType} has a duration`);
    assert.ok((d.targetLoadTss ?? 0) > 0, `${d.runType} has an sTSS target`);
    // Metres are 25 m granular (pool-realistic).
    assert.equal(d.distanceMeters % 25, 0, `${d.runType} metres are 25 m granular`);
  }
});

test('a technique session is present and is drill-structured', () => {
  const weeks = generatePlan(swimInput, swim);
  const base = weeks.find((w) => w.phase === 'base')!;
  // Technique days are quality days at the recovery zone with drill work segments.
  const technique = base.days.filter((d) => d.runType === 'quality' && d.zone === 'recovery');
  assert.ok(technique.length >= 1, 'at least one technique session');
  for (const t of technique) {
    assert.ok(t.segments && t.segments.length >= 3, 'warm-up → drills → cool-down');
    assert.equal(t.segments![0].role, 'warmup');
    assert.equal(t.segments!.at(-1)!.role, 'cooldown');
    const drill = t.segments!.find((s) => s.role === 'work' && /drill/i.test(s.note ?? ''));
    assert.ok(drill, 'has a named drill set');
    assert.ok(/[Tt]echnique/.test(t.description), 'described as a technique swim');
  }
});

test('quality days are CSS-relative warm-up → main set → cool-down with pace targets', () => {
  const weeks = generatePlan(swimInput, swim);
  const build = weeks.find((w) => w.phase === 'build')!;
  // A real interval quality day (not the technique/recovery one).
  const quality = build.days.filter((d) => d.runType === 'quality' && d.zone !== 'recovery');
  assert.ok(quality.length >= 1);
  for (const q of quality) {
    assert.ok(q.segments && q.segments.length >= 3);
    assert.equal(q.segments![0].role, 'warmup');
    assert.equal(q.segments!.at(-1)!.role, 'cooldown');
    const work = q.segments!.find((s) => s.role === 'work')!;
    // Pace targets come from the athlete's own CSS zones.
    assert.ok((work.targetFastSecPer100 ?? 0) > 0 && (work.targetSlowSecPer100 ?? 0) >= work.targetFastSecPer100!);
    const band = swim.zones[q.zone as 'threshold' | 'vo2max' | 'sprint'];
    assert.equal(work.targetFastSecPer100, band.fastSecPer100);
    assert.equal(work.targetSlowSecPer100, band.slowSecPer100);
    // Swim intervals are described in metres.
    assert.ok((work.repMeters ?? work.distanceMeters ?? 0) > 0, 'work is distance-at-CSS-pace');
  }
});

test('a day’s metres match its sTSS share at the target-zone IF', () => {
  const weeks = generatePlan(swimInput, swim);
  const build = weeks.find((w) => w.phase === 'build')!;
  const aerobic = build.days.find((d) => d.runType === 'easy')!;
  const expected = Math.round(metersFromStss(aerobic.targetLoadTss!, zoneIf('aerobic'), CSS) / 25) * 25;
  assert.equal(aerobic.distanceMeters, expected);
});

test('weekly sTSS is distributed across the days (conserved, like running miles)', () => {
  const weeks = generatePlan(swimInput, swim);
  for (const w of weeks) {
    const sum = w.days.reduce((s, d) => s + (d.targetLoadTss ?? 0), 0);
    assert.ok(w.targetLoadTss && w.targetLoadTss > 0);
    // Within a few sTSS of the week target (rounding across days).
    assert.ok(Math.abs(sum - w.targetLoadTss!) <= 3, `week ${w.weekStart}: sum ${sum} vs ${w.targetLoadTss}`);
  }
});

test('build/peak long swims embed CSS+ aerobic pulls (the marathon-pace analog)', () => {
  const weeks = generatePlan(swimInput, swim);
  const peak = weeks.find((w) => w.phase === 'peak')!;
  const long = peak.days.find((d) => d.runType === 'long')!;
  assert.ok(long.segments, 'a big long swim has structure');
  const work = long.segments!.find((s) => s.role === 'work')!;
  assert.equal(work.zone, 'aerobic');
  assert.ok((work.reps ?? 0) >= 3 && (work.repMeters ?? 0) > 0);
});

test('swim plan generation is deterministic', () => {
  assert.deepEqual(generatePlan(swimInput, swim), generatePlan(swimInput, swim));
});

// --- discipline isolation ----------------------------------------------------

test('the swim arm refuses pace zones (wrong discipline currency)', () => {
  const pace = buildZones(222.5);
  const [w] = periodize({ ...swimInput, volumeUnit: 'tss' });
  assert.throws(
    () => generateSwimWeek(w, COACH_SWIM_TEMPLATE_SET.build, pace, '', swimStrategy),
    /swim zones/,
  );
});

test('running is untouched: the run generator still yields distance-at-pace', () => {
  const pace = buildZones(222.5);
  const [w] = periodize({
    startDay: '2026-01-05',
    goalRaceDay: '2026-04-12',
    startVolumeMiles: 64,
    peakVolumeMiles: 70,
  });
  const runWeek = generateWeek(w, COACH_TEMPLATE_SET[w.phase], pace);
  assert.ok(runWeek.days.some((d) => d.distanceMeters > 0));
  assert.ok(runWeek.days.every((d) => d.durationSeconds === undefined));
});
