import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  periodize,
  generateWeek,
  generatePlan,
  generateBikeWeek,
  durationSecondsFromTss,
  COACH_BIKE_TEMPLATE_SET,
  COACH_TEMPLATE_SET,
  bikeStrategy,
  resolvePowerZones,
  buildZones,
} from '../index';
import { zoneIf } from '../../loadCurrencyLogic';

const power = resolvePowerZones({ ftpWatts: 250 }); // %FTP watt bands

const bikeInput = {
  startDay: '2026-01-05',
  goalRaceDay: '2026-06-14',
  startVolumeMiles: 350, // read as weekly TSS on the bike
  peakVolumeMiles: 620,
  discipline: 'bike' as const,
};

// --- the TSS→duration kernel (spec §4.3) -------------------------------------

test('durationSecondsFromTss inverts TSS = IF² × hours × 100', () => {
  // 1 hour at FTP (IF=1.0) is exactly 100 TSS → 3600 s.
  assert.equal(durationSecondsFromTss(100, 1.0), 3600);
  // 50 TSS at IF 0.65 endurance.
  const s = durationSecondsFromTss(50, 0.65);
  assert.ok(Math.abs(s - (50 / (0.65 * 0.65 * 100)) * 3600) < 1e-6);
  // Guards.
  assert.equal(durationSecondsFromTss(0, 1), 0);
  assert.equal(durationSecondsFromTss(50, 0), 0);
});

// --- periodize is unit-generic --------------------------------------------------

test('periodize on TSS ramps the generic load, not meters', () => {
  const weeks = periodize({ ...bikeInput, volumeUnit: 'tss' });
  for (const w of weeks) {
    assert.equal(w.loadUnit, 'tss');
    assert.equal(w.targetVolumeMeters, 0, 'no meters on the bike');
    assert.ok(w.targetLoad > 0, 'carries a TSS load');
  }
  // The ramp still peaks above the start and tapers below the peak.
  const maxLoad = Math.max(...weeks.map((w) => w.targetLoad));
  assert.ok(maxLoad > weeks[0].targetLoad);
  const taper = weeks.filter((w) => w.phase === 'taper');
  assert.ok(Math.max(...taper.map((w) => w.targetLoad)) < maxLoad);
});

// --- a coherent bike week -------------------------------------------------------

test('generatePlan(bike) returns power-based weeks: endurance + quality + long ride', () => {
  const weeks = generatePlan(bikeInput, power);
  assert.ok(weeks.length > 8);
  const build = weeks.find((w) => w.phase === 'build')!;

  // A long ride, at least one quality session, and endurance fill.
  const long = build.days.find((d) => d.runType === 'long')!;
  const quality = build.days.filter((d) => d.runType === 'quality');
  const endurance = build.days.filter((d) => d.runType === 'easy');
  assert.ok(long && quality.length >= 1 && endurance.length >= 1);

  // Every non-rest day is duration-based (no running distance), with a TSS target.
  for (const d of build.days) {
    assert.equal(d.distanceMeters, 0, 'bike days carry no distance');
    if (d.runType !== 'rest') {
      assert.ok((d.durationSeconds ?? 0) > 0, `${d.runType} has a duration`);
      assert.ok((d.targetLoadTss ?? 0) > 0, `${d.runType} has a TSS target`);
    }
  }

  // Quality days are warm-up → work → cool-down with real watt targets.
  for (const q of quality) {
    assert.ok(q.segments && q.segments.length >= 3);
    assert.equal(q.segments![0].role, 'warmup');
    assert.equal(q.segments!.at(-1)!.role, 'cooldown');
    const work = q.segments!.find((s) => s.role === 'work')!;
    assert.ok((work.targetLoWatts ?? 0) > 0 && (work.targetHiWatts ?? 0) >= work.targetLoWatts!);
    assert.ok((work.repSeconds ?? work.durationSeconds ?? 0) > 0, 'work is duration-at-power');
  }
});

test('a day duration matches its TSS share at the target-zone IF (spec §4.3)', () => {
  const weeks = generatePlan(bikeInput, power);
  const build = weeks.find((w) => w.phase === 'build')!;
  const endurance = build.days.find((d) => d.runType === 'easy')!;
  const expectedMin = Math.round(durationSecondsFromTss(endurance.targetLoadTss!, zoneIf('endurance')) / 60);
  assert.equal(Math.round(endurance.durationSeconds! / 60), expectedMin);
});

test('weekly TSS is distributed across the days (conserved, like running miles)', () => {
  const weeks = generatePlan(bikeInput, power);
  for (const w of weeks) {
    const sum = w.days.reduce((s, d) => s + (d.targetLoadTss ?? 0), 0);
    assert.ok(w.targetLoadTss && w.targetLoadTss > 0);
    // Within a couple of TSS of the week target (rounding across days).
    assert.ok(Math.abs(sum - w.targetLoadTss!) <= 3, `week ${w.weekStart}: sum ${sum} vs ${w.targetLoadTss}`);
    // No meters currency on the bike week.
    assert.equal(w.targetVolumeMeters, 0);
  }
});

test('build/peak long rides embed sweet-spot blocks (the marathon-pace analog)', () => {
  const weeks = generatePlan(bikeInput, power);
  const peak = weeks.find((w) => w.phase === 'peak')!;
  const long = peak.days.find((d) => d.runType === 'long')!;
  assert.ok(long.segments, 'a big long ride has structure');
  const work = long.segments!.find((s) => s.role === 'work')!;
  assert.equal(work.zone, 'sweetspot');
  assert.ok((work.reps ?? 0) >= 2 && (work.targetLoWatts ?? 0) > 0);
});

test('power targets come from the athlete’s own FTP zones', () => {
  const weeks = generatePlan(bikeInput, power);
  const build = weeks.find((w) => w.phase === 'build')!;
  const thr = build.days.find((d) => d.zone === 'threshold');
  if (thr) {
    const work = thr.segments!.find((s) => s.role === 'work')!;
    assert.deepEqual(
      { lo: work.targetLoWatts, hi: work.targetHiWatts },
      { lo: power.zones!.threshold.loWatts, hi: power.zones!.threshold.hiWatts },
    );
  }
});

test('bike plan generation is deterministic', () => {
  assert.deepEqual(generatePlan(bikeInput, power), generatePlan(bikeInput, power));
});

// --- discipline isolation -------------------------------------------------------

test('the bike arm refuses pace zones (wrong discipline currency)', () => {
  const pace = buildZones(222.5);
  const [w] = periodize({ ...bikeInput, volumeUnit: 'tss' });
  assert.throws(() => generateBikeWeek(w, COACH_BIKE_TEMPLATE_SET.build, pace, '', bikeStrategy), /power zones/);
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
