import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeekSchedule,
  layoutTriWeek,
  sessionsFromPlannedWeeks,
  estimateSessionMinutes,
  type TriScheduleSession,
  type WeekSchedule,
} from '../triScheduleLogic';
import type { Discipline, PlannedDay, PlannedWeek } from '../types';

// --- helpers -----------------------------------------------------------------

let seq = 0;
function session(
  discipline: Discipline,
  dow: number,
  opts: { minutes?: number; isLong?: boolean; isQuality?: boolean; id?: string } = {},
): TriScheduleSession {
  return {
    id: opts.id ?? `${discipline}-${dow}-${seq++}`,
    discipline,
    dow,
    minutes: opts.minutes ?? 45,
    isLong: opts.isLong ?? false,
    isQuality: opts.isQuality ?? false,
  };
}

/** dows that hold ≥1 session of the given discipline. */
function dowsWith(result: ReturnType<typeof layoutTriWeek>, d: Discipline): number[] {
  return result.days.filter((day) => day.sessions.some((s) => s.discipline === d)).map((day) => day.dow);
}

// --- schedule constructor ----------------------------------------------------

test('buildWeekSchedule expands a compact spec into 7 DayBudgets', () => {
  const sched = buildWeekSchedule({
    availableDays: [0, 1, 2, 4, 5, 6],
    poolDays: [1, 4],
    longDay: 5,
    defaultMinutes: 60,
  });
  assert.equal(sched.length, 7);
  // Wed (dow 3) is not available → a rest window.
  assert.deepEqual(sched[3], { availableMinutes: 0, poolAccess: false, isLongDay: false });
  // Tue (dow 1) has pool access, 60-min window.
  assert.equal(sched[1].poolAccess, true);
  assert.equal(sched[1].availableMinutes, 60);
  // Sat (dow 5) is the long day with the big default window.
  assert.equal(sched[5].isLongDay, true);
  assert.ok(sched[5].availableMinutes > sched[1].availableMinutes);
});

// --- swim → pool days only ---------------------------------------------------

test('swims land only on pool-access days', () => {
  // Pool only on Tue/Thu; the swim wants Wed natively.
  const sched = buildWeekSchedule({ poolDays: [1, 3], longDay: 5, defaultMinutes: 120 });
  const result = layoutTriWeek([session('swim', 2, { minutes: 40 })], sched);
  assert.equal(result.dropped.length, 0, 'swim placed');
  const swimDows = dowsWith(result, 'swim');
  assert.equal(swimDows.length, 1);
  assert.ok([1, 3].includes(swimDows[0]), `swim on a pool day (got ${swimDows[0]})`);
});

test('a swim is dropped when no pool day exists, with a reason', () => {
  const sched = buildWeekSchedule({ poolDays: [], longDay: 5, defaultMinutes: 120 });
  const result = layoutTriWeek([session('swim', 2)], sched);
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /pool/);
});

// --- long / brick → the long day --------------------------------------------

test('the long session lands on the long day, and a long ride + run form a brick', () => {
  // Long day = Sat (dow 5). Long ride natively on Sun, run off it natively on Wed.
  const sched = buildWeekSchedule({ longDay: 5, defaultMinutes: 90, longDayMinutes: 300 });
  const longRide = session('bike', 6, { minutes: 180, isLong: true });
  const longRun = session('run', 2, { minutes: 90, isLong: true });
  const result = layoutTriWeek([longRide, longRun], sched);
  assert.equal(result.dropped.length, 0);
  // Both long sessions co-locate on the long day → a brick.
  assert.deepEqual(dowsWith(result, 'bike'), [5]);
  assert.deepEqual(dowsWith(result, 'run'), [5]);
  assert.equal(result.days[5].isBrick, true, 'Saturday is a brick day');
});

test('a long session is dropped when there is no long-day window', () => {
  const sched = buildWeekSchedule({ availableDays: [0, 1, 2], defaultMinutes: 60 }); // no longDay
  const result = layoutTriWeek([session('bike', 1, { minutes: 50, isLong: true })], sched);
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /long-day/);
});

// --- no double-hard ----------------------------------------------------------

test('two quality/hard sessions never stack on one day', () => {
  // Both quality sessions want Tue (dow 1) natively; only one may stay there.
  const sched = buildWeekSchedule({ longDay: 5, defaultMinutes: 200 });
  const q1 = session('bike', 1, { minutes: 60, isQuality: true, id: 'bike-q' });
  const q2 = session('run', 1, { minutes: 60, isQuality: true, id: 'run-q' });
  const result = layoutTriWeek([q1, q2], sched);
  assert.equal(result.dropped.length, 0, 'both placed on different days');
  for (const day of result.days) {
    const hard = day.sessions.filter((s) => s.isQuality).length;
    assert.ok(hard <= 1, `at most one hard session on dow ${day.dow} (got ${hard})`);
  }
});

// --- graceful drop of the lowest-priority optional volume --------------------

test('an over-full week drops the lowest-priority optional volume first and records it', () => {
  // One tiny day (dow 0, 60 min) is the only training day besides the long day.
  // Rest day protection will claim dow 0, so everything must fit on the long day.
  const sched = buildWeekSchedule({ availableDays: [0, 5], longDay: 5, longDayMinutes: 120 });
  const longRide = session('bike', 5, { minutes: 90, isLong: true, id: 'bike-long' });
  const qualityRun = session('run', 5, { minutes: 40, isQuality: true, id: 'run-q' });
  const easySwim = session('swim', 5, { minutes: 30, id: 'swim-easy' }); // optional, no pool day
  const easyRun = session('run', 5, { minutes: 30, id: 'run-easy' }); // optional volume

  const result = layoutTriWeek([easyRun, easySwim, qualityRun, longRide], sched);

  // The long ride (highest priority) survives on the long day.
  assert.deepEqual(dowsWith(result, 'bike'), [5]);
  // Something got dropped and it was recorded.
  assert.ok(result.dropped.length >= 1, 'at least one drop');
  assert.ok(result.notes.some((n) => /dropped/i.test(n)), 'a drop note is emitted');
  // The dropped set is lower-priority than the long ride (never the long/brick).
  assert.ok(
    !result.dropped.some((d) => d.session.id === 'bike-long'),
    'the long/brick is never the thing dropped',
  );
  // The easy optional volume is dropped before the quality run.
  const droppedIds = new Set(result.dropped.map((d) => d.session.id));
  assert.ok(droppedIds.has('run-easy') || droppedIds.has('swim-easy'), 'optional volume dropped');
});

test('at least one recovery day is protected when days are available', () => {
  const sched = buildWeekSchedule({ defaultMinutes: 120, longDay: 5 });
  // Flood every day with easy volume.
  const sessions: TriScheduleSession[] = [];
  for (let dow = 0; dow < 7; dow++) sessions.push(session('bike', dow, { minutes: 60 }));
  const result = layoutTriWeek(sessions, sched);
  const emptyDays = result.days.filter((d) => d.sessions.length === 0).length;
  assert.ok(emptyDays >= 1, 'a rest day is protected');
  assert.ok(result.notes.some((n) => /recovery day/i.test(n)));
});

// --- no-schedule pass-through == naive placement -----------------------------

test('no-schedule layout reproduces naive by-day-of-week placement', () => {
  const sessions = [
    session('swim', 0, { id: 'a' }),
    session('bike', 2, { id: 'b' }),
    session('run', 2, { id: 'c' }),
    session('bike', 5, { id: 'd', isLong: true }),
    session('run', 5, { id: 'e' }),
  ];
  const result = layoutTriWeek(sessions);
  assert.equal(result.dropped.length, 0, 'nothing dropped in pass-through');
  assert.equal(result.notes.length, 0, 'no notes in pass-through');
  // Each session sits exactly on its native dow.
  for (const s of sessions) {
    assert.ok(
      result.days[s.dow].sessions.some((p) => p.id === s.id),
      `${s.id} on its native dow ${s.dow}`,
    );
  }
  // dow 5 has both bike + run → brick even in the naive path.
  assert.equal(result.days[5].isBrick, true);
  // dow 2 also co-locates bike + run.
  assert.equal(result.days[2].isBrick, true);
});

// --- determinism -------------------------------------------------------------

test('same input twice → identical output (scheduled path)', () => {
  const sched = buildWeekSchedule({ poolDays: [1, 3], longDay: 5, defaultMinutes: 90 });
  const build = (): TriScheduleSession[] => [
    session('run', 2, { id: 'r1', isQuality: true }),
    session('bike', 4, { id: 'b1' }),
    session('swim', 0, { id: 's1' }),
    session('bike', 5, { id: 'b2', minutes: 150, isLong: true }),
    session('run', 5, { id: 'r2', minutes: 80, isLong: true }),
  ];
  const a = layoutTriWeek(build(), sched);
  const b = layoutTriWeek(build(), sched);
  assert.deepEqual(a, b);
});

test('placement is independent of input order (deterministic sort)', () => {
  const sched = buildWeekSchedule({ poolDays: [1, 3], longDay: 5, defaultMinutes: 90 });
  const s1 = session('run', 2, { id: 'r1', isQuality: true });
  const s2 = session('bike', 4, { id: 'b1' });
  const s3 = session('swim', 0, { id: 's1' });
  const forward = layoutTriWeek([s1, s2, s3], sched);
  const reversed = layoutTriWeek([s3, s2, s1], sched);
  // Same day assignment for each id regardless of input order.
  const place = (r: ReturnType<typeof layoutTriWeek>) =>
    Object.fromEntries(
      r.days.flatMap((day) => day.sessions.map((s) => [s.id, day.dow] as const)),
    );
  assert.deepEqual(place(forward), place(reversed));
});

// --- session derivation from planned weeks -----------------------------------

test('sessionsFromPlannedWeeks skips rest and derives flags + minutes', () => {
  const runDay = (dow: number, runType: PlannedDay['runType'], m: number): PlannedDay => ({
    day: '2026-08-17',
    dow,
    runType,
    zone: runType === 'rest' ? null : 'easy',
    distanceMeters: m,
    description: 't',
    pinned: false,
  });
  const bikeDay = (dow: number, seconds: number, quality: boolean): PlannedDay => ({
    day: '2026-08-17',
    dow,
    runType: quality ? 'quality' : 'easy',
    zone: 'endurance',
    distanceMeters: 0,
    durationSeconds: seconds,
    description: 't',
    pinned: false,
  });
  const week = (days: PlannedDay[]): PlannedWeek => ({
    weekStart: '2026-08-17',
    phase: 'build',
    cycle: 1,
    targetVolumeMeters: 0,
    days,
    rationale: '',
  });

  const sessions = sessionsFromPlannedWeeks({
    run: week([runDay(0, 'rest', 0), runDay(2, 'quality', 10000), runDay(6, 'long', 20000)]),
    bike: week([bikeDay(3, 3600, false), bikeDay(5, 2700, true)]),
  });

  // Rest day is skipped; 2 run + 2 bike sessions remain.
  assert.equal(sessions.length, 4);
  const longRun = sessions.find((s) => s.discipline === 'run' && s.isLong)!;
  assert.ok(longRun, 'long run derived');
  const qualityBike = sessions.find((s) => s.discipline === 'bike' && s.isQuality)!;
  assert.ok(qualityBike, 'quality bike derived');
  // Bike minutes come straight from durationSeconds.
  assert.equal(sessions.find((s) => s.id === 'bike-3')!.minutes, 60);
  // Run minutes priced from distance (10 km at the default easy pace).
  assert.equal(estimateSessionMinutes(runDay(2, 'quality', 10000)), 60);
});
