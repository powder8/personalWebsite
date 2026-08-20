import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleCalendar,
  mondayOf,
  dowIndex,
  addDays,
  type CalPlanned,
  type CalActual,
} from '@/server/trainingCalendarLogic';

const MI = 1609.344;
const planned = (over: Partial<CalPlanned> = {}): CalPlanned => ({
  sessionType: 'easy',
  discipline: 'run',
  zone: 'easy',
  miles: 5,
  durationMinutes: 0,
  meters: 0,
  loadTss: 0,
  paceFastSecPerKm: 300,
  paceSlowSecPerKm: 330,
  description: null,
  adjustments: [],
  ...over,
});
const run = (over: Partial<CalActual> = {}): CalActual => ({
  activityId: 'a1',
  sport: 'run',
  isRun: true,
  workoutType: null,
  name: 'Run',
  miles: 5,
  paceSecPerKm: 315,
  durationSeconds: 1500,
  elevationGainMeters: 0,
  surface: 'road',
  avgHr: 140,
  ...over,
});

test('mondayOf / dowIndex anchor the week to Monday', () => {
  // 2026-06-14 is a Sunday → dow 6, Monday is 2026-06-08.
  assert.equal(dowIndex('2026-06-14'), 6);
  assert.equal(mondayOf('2026-06-14'), '2026-06-08');
  assert.equal(dowIndex('2026-06-08'), 0);
});

test('planned run hit → done with a positive verdict; week mileage aggregates', () => {
  const today = '2026-06-10'; // Wednesday
  const weekStart = mondayOf(today); // 2026-06-08
  const weeks = assembleCalendar({
    today,
    weekStarts: [weekStart],
    plannedByDay: new Map([[today, [planned({ miles: 5 })]]]),
    actualsByDay: new Map([[today, [run({ miles: 5 })]]]),
    phaseByWeekStart: new Map([[weekStart, 'base']]),
  });
  const w = weeks[0];
  assert.equal(w.isCurrent, true);
  assert.equal(w.phase, 'base');
  const day = w.days.find((d) => d.day === today)!;
  assert.equal(day.status, 'done');
  assert.equal(day.verdict?.positive, true);
  assert.equal(w.sessionsPlanned, 1);
  assert.equal(w.sessionsDone, 1);
  assert.equal(w.adherencePct, 100);
  assert.ok(Math.abs(w.plannedMiles - 5) < 1e-9);
  assert.ok(Math.abs(w.actualMiles - 5) < 1e-9);
});

test('planned run with nothing logged → missed', () => {
  const today = '2026-06-12';
  const planDay = '2026-06-10';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map([[planDay, [planned({ miles: 6 })]]]),
    actualsByDay: new Map(),
    phaseByWeekStart: new Map(),
  });
  const day = weeks[0].days.find((d) => d.day === planDay)!;
  assert.equal(day.status, 'missed');
  assert.equal(day.verdict, null);
  assert.equal(weeks[0].adherencePct, 0);
});

test('ran short → partial', () => {
  const today = '2026-06-10';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map([[today, [planned({ miles: 10 })]]]),
    actualsByDay: new Map([[today, [run({ miles: 4 })]]]), // <80%
    phaseByWeekStart: new Map(),
  });
  assert.equal(weeks[0].days.find((d) => d.day === today)!.status, 'partial');
});

test('unplanned run on a rest day → extra with bonus verdict', () => {
  const today = '2026-06-10';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map([[today, [planned({ sessionType: 'rest', miles: 0 })]]]),
    actualsByDay: new Map([[today, [run({ miles: 3 })]]]),
    phaseByWeekStart: new Map(),
  });
  const day = weeks[0].days.find((d) => d.day === today)!;
  assert.equal(day.status, 'extra');
  assert.equal(day.verdict?.verdict, 'extra');
});

test('cross-training only (no run) → cross, surfaced separately', () => {
  const today = '2026-06-10';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map(),
    actualsByDay: new Map([[today, [run({ sport: 'bike', isRun: false, miles: 12 })]]]),
    phaseByWeekStart: new Map(),
  });
  const day = weeks[0].days.find((d) => d.day === today)!;
  assert.equal(day.status, 'cross');
  assert.equal(day.crossTrain.length, 1);
  assert.equal(day.primaryRun, null);
  assert.ok(Math.abs(day.actuals[0].miles - 12) < 1e-9);
  assert.equal(weeks[0].actualMiles, 0); // cross-training doesn't count as run miles
});

test('today with a planned run but nothing logged yet → upcoming, not missed', () => {
  const today = '2026-06-10';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map([[today, [planned({ miles: 8 })]]]),
    actualsByDay: new Map(),
    phaseByWeekStart: new Map(),
  });
  const day = weeks[0].days.find((d) => d.day === today)!;
  assert.equal(day.status, 'upcoming');
  assert.equal(day.verdict, null);
  // Mid-day, an unrun session must not count against adherence.
  assert.equal(weeks[0].sessionsPlanned, 0);
  assert.equal(weeks[0].adherencePct, null);
});

test('future planned run → upcoming, no verdict', () => {
  const today = '2026-06-10';
  const future = addDays(today, 2);
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map([[future, [planned({ miles: 8 })]]]),
    actualsByDay: new Map(),
    phaseByWeekStart: new Map(),
  });
  const day = weeks[0].days.find((d) => d.day === future)!;
  assert.equal(day.isFuture, true);
  assert.equal(day.status, 'upcoming');
  assert.equal(day.verdict, null);
  assert.equal(weeks[0].sessionsPlanned, 0); // not counted until it's due
});

test('primary run is the longest when multiple runs in a day', () => {
  const today = '2026-06-10';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map([[today, [planned({ miles: 8 })]]]),
    actualsByDay: new Map([
      [today, [run({ activityId: 'am', miles: 3 }), run({ activityId: 'pm', miles: 6 })]],
    ]),
    phaseByWeekStart: new Map(),
  });
  const day = weeks[0].days.find((d) => d.day === today)!;
  assert.equal(day.primaryRun?.activityId, 'pm');
  assert.ok(Math.abs(day.actuals.reduce((s, a) => s + a.miles, 0) - 9) < 1e-9);
  assert.equal(day.status, 'done'); // 9 total >= 80% of 8
});

// --- discipline-aware calendar (cyclist) ------------------------------------

test('a planned BIKE day is a real session, not "rest" (upcoming in the future)', () => {
  const today = '2026-06-10';
  const bikeDay = '2026-06-12';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf(today)],
    plannedByDay: new Map([[bikeDay, [planned({ discipline: 'bike', sessionType: 'endurance', miles: 0, durationMinutes: 45 })]]]),
    actualsByDay: new Map(),
    phaseByWeekStart: new Map(),
  });
  const day = weeks[0].days.find((d) => d.day === bikeDay)!;
  assert.equal(day.status, 'upcoming'); // was wrongly 'rest' when miles-only
  assert.equal(weeks[0].primaryDiscipline, 'bike');
  assert.ok(Math.abs(weeks[0].plannedMinutes - 45) < 1e-9);
  assert.equal(weeks[0].plannedMiles, 0);
});

test('a past planned bike day → done when a ride was logged, missed when not', () => {
  const today = '2026-06-14';
  const rideDay = '2026-06-09';
  const missDay = '2026-06-10';
  const weeks = assembleCalendar({
    today,
    weekStarts: [mondayOf('2026-06-09')],
    plannedByDay: new Map([
      [rideDay, [planned({ discipline: 'bike', sessionType: 'endurance', miles: 0, durationMinutes: 60 })]],
      [missDay, [planned({ discipline: 'bike', sessionType: 'threshold', miles: 0, durationMinutes: 50 })]],
    ]),
    actualsByDay: new Map([
      [rideDay, [run({ activityId: 'ride', sport: 'bike', isRun: false, miles: 18, durationSeconds: 3600 })]],
    ]),
    phaseByWeekStart: new Map(),
  });
  const w = weeks[0];
  assert.equal(w.days.find((d) => d.day === rideDay)!.status, 'done');
  assert.equal(w.days.find((d) => d.day === missDay)!.status, 'missed');
  assert.ok(Math.abs(w.actualMinutes - 60) < 1e-9); // ride duration counted
  assert.equal(w.sessionsPlanned, 2);
  assert.equal(w.sessionsDone, 1);
  assert.equal(w.adherencePct, 50);
});

void MI;

test('a brick day keeps BOTH sports: plannedAll lists them and weekly totals sum both', () => {
  const today = '2026-06-10';
  const weekStart = mondayOf(today);
  const weeks = assembleCalendar({
    today,
    weekStarts: [weekStart],
    // Same day: a bike session AND a run session (a brick) — neither is dropped.
    plannedByDay: new Map([
      [today, [
        planned({ discipline: 'bike', sessionType: 'endurance', miles: 0, durationMinutes: 60 }),
        planned({ discipline: 'run', sessionType: 'easy', miles: 4 }),
      ]],
    ]),
    actualsByDay: new Map(),
    phaseByWeekStart: new Map([[weekStart, 'build']]),
  });
  const day = weeks[0].days.find((d) => d.day === today)!;
  assert.equal(day.plannedAll.length, 2, 'both sessions survive');
  assert.ok(day.plannedAll.some((p) => p.discipline === 'bike'));
  assert.ok(day.plannedAll.some((p) => p.discipline === 'run'));
  // Primary (run-first) drives status/grading.
  assert.equal(day.planned?.discipline, 'run');
  // Weekly totals count BOTH sports, not just the primary.
  assert.ok(Math.abs(weeks[0].plannedMiles - 4) < 1e-9, 'run miles counted');
  assert.ok(Math.abs(weeks[0].plannedMinutes - 60) < 1e-9, 'bike minutes counted');
});
