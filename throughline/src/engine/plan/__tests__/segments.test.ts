import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, resolvePaceZones } from '../index';
import type { PlannedDay, PlannedWeek } from '../types';

const zones = resolvePaceZones({ race: { distanceMeters: 21097.5, timeSeconds: 73 * 60 } });
const weeks: PlannedWeek[] = generatePlan(
  {
    startDay: '2026-06-15',
    goalRaceDay: '2026-10-04',
    startVolumeMiles: 50,
    peakVolumeMiles: 70,
    keyRaces: [],
  },
  zones,
);
const allDays: (PlannedDay & { phase: PlannedWeek['phase'] })[] = weeks.flatMap((w) =>
  w.days.map((d) => ({ ...d, phase: w.phase })),
);

test('quality days carry warmup / work / cooldown segments with prescriptive notes', () => {
  const q = allDays.find((d) => d.runType === 'quality' && d.segments?.length);
  assert.ok(q, 'found a quality day with segments');
  const roles = q!.segments!.map((s) => s.role);
  assert.deepEqual(roles, ['warmup', 'work', 'cooldown']);
  assert.match(q!.segments![0].note ?? '', /strides/i);
  assert.match(q!.segments![2].note ?? '', /easy/i);
});

test('interval days prescribe reps with jog recoveries, not a single lump', () => {
  const day = allDays.find((d) => d.runType === 'quality' && d.zone === 'interval' && d.segments?.length);
  assert.ok(day, 'found an interval day');
  const work = day!.segments!.find((s) => s.role === 'work')!;
  assert.ok((work.reps ?? 0) >= 3, `reps ${work.reps}`);
  assert.ok((work.repMeters ?? 0) > 0);
  assert.ok((work.restSeconds ?? 0) > 0);
  assert.match(work.note ?? '', /×/);
});

test('long threshold work becomes 1-mi cruise intervals with 60s rests', () => {
  const day = allDays.find(
    (d) =>
      d.runType === 'quality' &&
      d.zone === 'threshold' &&
      d.segments?.some((s) => s.role === 'work' && (s.reps ?? 0) >= 4),
  );
  assert.ok(day, 'found a cruise-interval threshold day at this volume');
  const work = day!.segments!.find((s) => s.role === 'work')!;
  assert.equal(work.restSeconds, 60);
  assert.match(work.note ?? '', /cruise/i);
});

test('big build/peak long runs get marathon-pace blocks with easy lead-in and finish', () => {
  const long = allDays.find(
    (d) => d.runType === 'long' && (d.phase === 'build' || d.phase === 'peak') && d.segments?.length,
  );
  assert.ok(long, 'found a structured long run');
  const work = long!.segments!.find((s) => s.role === 'work')!;
  assert.equal(work.zone, 'marathon');
  assert.ok((work.reps ?? 0) >= 2);
  assert.equal(long!.segments![0].role, 'warmup');
  assert.equal(long!.segments![long!.segments!.length - 1].role, 'cooldown');
});

test('easy/steady runs stay unstructured (description only)', () => {
  const easy = allDays.find((d) => d.runType === 'easy');
  assert.ok(easy);
  assert.ok(!easy!.segments || easy!.segments.length === 0);
});
