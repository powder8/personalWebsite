import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildZones,
  estimateThresholdSecPerKm,
  midpoint,
  metersToMiles,
  periodize,
  dowMon0,
  generateWeek,
  generatePlan,
  adaptWeek,
  COACH_TEMPLATE_SET,
  type ZoneKey,
} from '../index';

// --- zones ---

test('zones are correctly ordered fast→slow and scale with threshold', () => {
  const z = buildZones(222.5); // ~5:58/mi threshold (elite)
  const order: ZoneKey[] = ['rep', 'interval', 'threshold', 'marathon', 'maintenance', 'easy', 'recovery'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      midpoint(z.zones[order[i]]) > midpoint(z.zones[order[i - 1]]),
      `${order[i]} should be slower than ${order[i - 1]}`,
    );
  }
  // Within a zone, fast bound is faster (smaller) than slow bound.
  for (const k of order) assert.ok(z.zones[k].fastSecPerKm <= z.zones[k].slowSecPerKm);
});

test('the same model produces elite and recreational zones from each threshold', () => {
  const elite = buildZones(222.5); // ~5:58/mi
  const rec = buildZones(360); // ~9:39/mi threshold (4hr-marathon-ish)
  // Maintenance pace should be far apart and both slower than their own threshold.
  assert.ok(midpoint(rec.zones.maintenance) > midpoint(elite.zones.maintenance) + 100);
  assert.ok(midpoint(elite.zones.maintenance) > elite.thresholdSecPerKm);
  assert.ok(midpoint(rec.zones.maintenance) > rec.thresholdSecPerKm);
});

test('elite maintenance lands near the coach prescription (~7:10/mi)', () => {
  const z = buildZones(222.5);
  const maintMinPerMile = (midpoint(z.zones.maintenance) * 1.609344) / 60;
  assert.ok(maintMinPerMile > 7.0 && maintMinPerMile < 7.4, `got ${maintMinPerMile}`);
});

test('Riegel threshold estimate is sane and faster than a slower race pace', () => {
  // A 40:00 10K → threshold a touch slower than 10K pace.
  const thr = estimateThresholdSecPerKm({ distanceMeters: 10000, timeSeconds: 2400 });
  const pace10k = 2400 / 10;
  assert.ok(thr > pace10k, 'threshold slightly slower than 10K pace');
  assert.ok(thr < pace10k * 1.1);
});

// --- periodization ---

test('dowMon0: Monday=0, and a known Monday resolves correctly', () => {
  assert.equal(dowMon0('2026-01-05'), 0); // 2026-01-05 is a Monday
  assert.equal(dowMon0('2026-01-01'), 3); // Thursday
});

test('periodize phases the build backward and tapers into the race', () => {
  const weeks = periodize({
    startDay: '2026-01-05',
    goalRaceDay: '2026-04-12', // ~14 weeks
    startVolumeMiles: 45,
    peakVolumeMiles: 70,
  });
  assert.ok(weeks.length >= 12 && weeks.length <= 14);
  assert.equal(weeks[0].phase, 'base');
  assert.equal(weeks[weeks.length - 1].phase, 'taper');
  // Peak volume occurs in a peak week and exceeds the first base week.
  const peak = weeks.filter((w) => w.phase === 'peak');
  assert.ok(peak.length >= 1);
  const maxVol = Math.max(...weeks.map((w) => w.targetVolumeMeters));
  assert.ok(maxVol > weeks[0].targetVolumeMeters);
  // Taper volume is below peak.
  const taper = weeks.filter((w) => w.phase === 'taper');
  assert.ok(Math.max(...taper.map((w) => w.targetVolumeMeters)) < maxVol);
  // All weeks start on Mondays.
  for (const w of weeks) assert.equal(dowMon0(w.weekStart), 0);
});

test('down weeks reduce volume relative to the prior ramping week', () => {
  const weeks = periodize({
    startDay: '2026-01-05',
    goalRaceDay: '2026-06-01', // long build so a 4th-week down week appears in ramp
    startVolumeMiles: 40,
    peakVolumeMiles: 80,
    downWeekEvery: 4,
  });
  const w3 = weeks[2];
  const w4 = weeks[3]; // 4th week → down week
  if (w4.phase === 'base' || w4.phase === 'build') {
    assert.ok(w4.targetVolumeMeters < w3.targetVolumeMeters, 'down week backs off');
  }
});

// --- generation ---

const zones = buildZones(222.5);

test('generated week conserves volume (≈ target) and respects the long-run cap', () => {
  const [w] = periodize({
    startDay: '2026-01-05',
    goalRaceDay: '2026-04-12',
    startVolumeMiles: 64,
    peakVolumeMiles: 70,
  });
  const week = generateWeek(w, COACH_TEMPLATE_SET[w.phase], zones);
  const totalMi = week.days.reduce((s, d) => s + metersToMiles(d.distanceMeters), 0);
  const targetMi = metersToMiles(w.targetVolumeMeters);
  assert.ok(Math.abs(totalMi - targetMi) <= 2, `total ${totalMi} vs target ${targetMi}`);
  const long = week.days.find((d) => d.runType === 'long')!;
  assert.ok(metersToMiles(long.distanceMeters) <= 22);
});

test('generated week has quality days with warmup/work/cooldown segments', () => {
  const weeks = periodize({
    startDay: '2026-01-05',
    goalRaceDay: '2026-04-12',
    startVolumeMiles: 64,
    peakVolumeMiles: 70,
  });
  const buildWeek = weeks.find((w) => w.phase === 'build')!;
  const week = generateWeek(buildWeek, COACH_TEMPLATE_SET.build, zones);
  const quality = week.days.filter((d) => d.runType === 'quality');
  assert.ok(quality.length >= 1);
  for (const q of quality) {
    assert.ok(q.segments && q.segments.length === 3);
    assert.equal(q.segments![0].role, 'warmup');
    assert.equal(q.segments![1].role, 'work');
    assert.equal(q.segments![2].role, 'cooldown');
  }
});

test('plan generation is deterministic', () => {
  const input = {
    startDay: '2026-01-05',
    goalRaceDay: '2026-04-12',
    startVolumeMiles: 50,
    peakVolumeMiles: 68,
  };
  assert.deepEqual(generatePlan(input, zones), generatePlan(input, zones));
});

// --- adaptation ---

function buildWeekFixture() {
  const weeks = periodize({
    startDay: '2026-01-05',
    goalRaceDay: '2026-04-12',
    startVolumeMiles: 64,
    peakVolumeMiles: 70,
  });
  const bw = weeks.find((w) => w.phase === 'build')!;
  return generateWeek(bw, COACH_TEMPLATE_SET.build, zones);
}

test('low readiness downgrades a quality day to easy and shortens it', () => {
  const week = buildWeekFixture();
  const quality = week.days.find((d) => d.runType === 'quality')!;
  const { week: adapted, changes } = adaptWeek(week, {
    readiness: { [quality.day]: 'easy' },
  });
  const after = adapted.days.find((d) => d.day === quality.day)!;
  assert.equal(after.runType, 'easy');
  assert.ok(after.distanceMeters < quality.distanceMeters);
  assert.ok(changes.some((c) => c.reason === 'low_readiness'));
});

test('pinned days are never modified', () => {
  const week = buildWeekFixture();
  const quality = week.days.find((d) => d.runType === 'quality')!;
  quality.pinned = true;
  const { week: adapted, changes } = adaptWeek(week, {
    readiness: { [quality.day]: 'easy' },
  });
  const after = adapted.days.find((d) => d.day === quality.day)!;
  assert.equal(after.runType, 'quality');
  assert.ok(!changes.some((c) => c.day === quality.day));
});

test('active injury barring running converts runs to cross-training', () => {
  const week = buildWeekFixture();
  const { week: adapted, changes } = adaptWeek(week, {
    injuries: [{ bodyPart: 'achilles', allowedModalities: ['bike', 'pool_run'] }],
  });
  const runs = adapted.days.filter((d) => d.runType !== 'rest');
  assert.ok(runs.every((d) => d.runType === 'cross_train'));
  assert.ok(changes.some((c) => c.reason === 'injury_modality'));
});

test('high soreness on a long run eases it; missed sessions flag no-cramming', () => {
  const week = buildWeekFixture();
  const long = week.days.find((d) => d.runType === 'long')!;
  const { changes } = adaptWeek(week, {
    soreness: { [long.day]: 8 },
    missedSessionsLast7: 3,
  });
  assert.ok(changes.some((c) => c.reason === 'high_soreness'));
  assert.ok(changes.some((c) => c.reason === 'missed_sessions'));
});
