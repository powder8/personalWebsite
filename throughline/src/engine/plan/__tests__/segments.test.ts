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

test('threshold days are specific structured sessions — pace + explicit recovery', () => {
  const thrDays = allDays.filter((d) => d.runType === 'quality' && d.zone === 'threshold' && d.segments?.length);
  assert.ok(thrDays.length > 0, 'found threshold quality days');
  // Every threshold work segment states the athlete's pace.
  for (const d of thrDays) {
    const work = d.segments!.find((s) => s.role === 'work')!;
    assert.match(work.note ?? '', /@/, `pace in note: ${work.note}`);
  }
  // Rep-based cruise templates name a recovery type + duration (jog / standing).
  const repBased = thrDays
    .map((d) => d.segments!.find((s) => s.role === 'work')!)
    .find((w) => (w.reps ?? 0) >= 2);
  if (repBased) {
    assert.ok((repBased.restSeconds ?? 0) > 0, 'rep recovery has a duration');
    assert.match(repBased.note ?? '', /jog|rest|standing/i, `recovery type: ${repBased.note}`);
  }
});

test('the same session type varies across the plan (template rotation)', () => {
  const notes = new Set(
    allDays
      .filter((d) => d.runType === 'quality' && d.zone === 'threshold' && d.segments?.length)
      .map((d) => d.segments!.find((s) => s.role === 'work')!.note),
  );
  assert.ok(notes.size >= 2, `expected varied threshold sessions, got ${notes.size}`);
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
