import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateTriBudget,
  buildTriPlan,
  composeTriWeeks,
  buildWeekSchedule,
  tssFromHours,
  TRI_DISCIPLINES,
  DEFAULT_FLOORS,
  TYPICAL_WEEKLY_IF,
  buildZonesFromVdot,
  buildPowerZones,
  buildSwimZones,
  type Discipline,
  type TrainingZones,
} from '../index';

// --- shared fixtures ---------------------------------------------------------

const zones: Record<Discipline, TrainingZones> = {
  run: buildZonesFromVdot(50),
  bike: buildPowerZones(250),
  swim: buildSwimZones(1.25),
};

const base = {
  startDay: '2026-08-17', // a Monday
  goalRaceDay: '2027-06-13',
  distance: '70.3' as const,
  weeklyHours: 8,
  limiter: 'run' as const,
  zones,
};

// --- the hours→TSS kernel ----------------------------------------------------

test('tssFromHours applies IF² × hours × 100', () => {
  assert.equal(Math.round(tssFromHours(1, 0.75)), 56); // one hour at IF 0.75
  assert.equal(tssFromHours(0, 0.75), 0);
  assert.equal(tssFromHours(2, 0), 0);
});

// --- 70.3 allocation is bike-weighted, swim floored --------------------------

test('8 h 70.3 is bike-weighted with swim held near its floor', () => {
  const a = allocateTriBudget({ weeklyHours: 8, distance: '70.3', limiter: 'run' });

  // Conservation: hours sum back to the budget.
  const totalHours = TRI_DISCIPLINES.reduce((s, d) => s + a.budgets[d].hours, 0);
  // hours is rounded to 0.1 for display, so summing three can drift up to ~0.15.
  assert.ok(Math.abs(totalHours - 8) < 0.2, `hours conserved (${totalHours})`);

  // Bike gets the most hours AND the most TSS — half the day, cheapest to recover.
  assert.ok(a.budgets.bike.hours > a.budgets.run.hours, 'bike > run hours');
  assert.ok(a.budgets.run.hours > a.budgets.swim.hours, 'run > swim hours');
  assert.ok(a.budgets.bike.tss > a.budgets.run.tss && a.budgets.bike.tss > a.budgets.swim.tss);

  // Swim is held near its 1.0 h floor (small surplus).
  assert.ok(a.budgets.swim.surplusHours < a.budgets.bike.surplusHours);
  assert.ok(a.budgets.swim.hours < 2.2, `swim near floor (${a.budgets.swim.hours} h)`);

  // Every sport clears its floor.
  for (const d of TRI_DISCIPLINES) {
    assert.ok(a.budgets[d].hours >= DEFAULT_FLOORS[d].minHoursPerWeek - 1e-6, `${d} >= floor`);
    assert.ok(a.budgets[d].tss > 0);
  }
});

// --- the self-reported limiter boosts its own sport --------------------------

test('the limiter boost moves hours toward the stated weakness', () => {
  const runLim = allocateTriBudget({ weeklyHours: 10, distance: '70.3', limiter: 'run' });
  const swimLim = allocateTriBudget({ weeklyHours: 10, distance: '70.3', limiter: 'swim' });
  const bikeLim = allocateTriBudget({ weeklyHours: 10, distance: '70.3', limiter: 'bike' });

  // Naming run the limiter yields more run hours than when swim/bike is.
  assert.ok(runLim.budgets.run.hours > swimLim.budgets.run.hours, 'run limiter → more run');
  // Naming swim the limiter yields more swim hours than the other cases.
  assert.ok(swimLim.budgets.swim.hours > runLim.budgets.swim.hours, 'swim limiter → more swim');
  assert.ok(swimLim.budgets.swim.hours > bikeLim.budgets.swim.hours);
  assert.ok(swimLim.budgets.swim.isLimiter && !runLim.budgets.swim.isLimiter);

  // Even boosted, the swim doesn't overtake the bike on a 70.3 (race demand caps it).
  assert.ok(swimLim.budgets.bike.hours > swimLim.budgets.swim.hours, 'bike still leads');
});

// --- floors respected (and scaled) at low budgets ----------------------------

test('floors are respected when the budget barely covers them', () => {
  // Just above the 4.5 h floor total: each sport sits at ~its floor, bike takes surplus.
  const a = allocateTriBudget({ weeklyHours: 5, distance: '70.3', limiter: 'run' });
  for (const d of TRI_DISCIPLINES) {
    assert.ok(a.budgets[d].hours >= DEFAULT_FLOORS[d].minHoursPerWeek - 1e-6, `${d} >= floor`);
  }
  assert.equal(a.floorsScaled, false);
  // Swim pinned at its floor (tiny surplus).
  assert.ok(a.budgets.swim.hours <= DEFAULT_FLOORS.swim.minHoursPerWeek + 0.4);
});

test('below the floor total, floors scale proportionally and conserve hours', () => {
  const a = allocateTriBudget({ weeklyHours: 3, distance: '70.3', limiter: 'swim' });
  assert.equal(a.floorsScaled, true);
  const totalHours = TRI_DISCIPLINES.reduce((s, d) => s + a.budgets[d].hours, 0);
  assert.ok(Math.abs(totalHours - 3) < 0.2, `hours conserved under scaling (${totalHours})`);
  // No surplus when below floors — everything is floor.
  for (const d of TRI_DISCIPLINES) assert.ok(a.budgets[d].surplusHours < 1e-6);
  // Proportions of the floors preserved: bike floor (2.0) > run (1.5) > swim (1.0).
  assert.ok(a.budgets.bike.hours > a.budgets.run.hours);
  assert.ok(a.budgets.run.hours > a.budgets.swim.hours);
});

// --- TSS matches the intended IF pricing -------------------------------------

test('per-sport TSS is priced from hours by the sport IF (build phase = 1.0)', () => {
  const a = allocateTriBudget({ weeklyHours: 8, distance: '70.3', limiter: 'run', phase: 'build' });
  for (const d of TRI_DISCIPLINES) {
    const expected = Math.round(tssFromHours(a.budgets[d].hours, TYPICAL_WEEKLY_IF[d]));
    // within rounding of the hours field (hours is rounded to 0.1)
    assert.ok(Math.abs(a.budgets[d].tss - expected) <= 6, `${d} tss ${a.budgets[d].tss} ~ ${expected}`);
  }
});

test('taper phase scales the budgets down', () => {
  const build = allocateTriBudget({ weeklyHours: 8, distance: '70.3', limiter: 'run', phase: 'build' });
  const taper = allocateTriBudget({ weeklyHours: 8, distance: '70.3', limiter: 'run', phase: 'taper' });
  assert.ok(taper.totalTss < build.totalTss, 'taper < build total TSS');
});

// --- the composed multi-sport week -------------------------------------------

test('buildTriPlan composes a full week with all three sports and a bike→run brick', () => {
  const plan = buildTriPlan(base);

  // Three sports each got a periodized plan of the same length.
  assert.ok(plan.perSport.run.length > 0);
  assert.equal(plan.perSport.bike.length, plan.perSport.run.length);
  assert.equal(plan.perSport.swim.length, plan.perSport.run.length);

  // Pick a mid-build week (not taper) and check the composition.
  const wk = plan.weeks[Math.floor(plan.weeks.length / 2)];
  const sportsSeen = new Set<Discipline>();
  for (const day of wk.days) {
    for (const d of TRI_DISCIPLINES) if (day.sessions[d]) sportsSeen.add(d);
  }
  assert.equal(sportsSeen.size, 3, 'all three sports appear in the week');

  // A brick is placed, and it is bike→run.
  assert.ok(wk.hasBrick, 'week has a brick');
  const brickDay = wk.days.find((d) => d.brick);
  assert.ok(brickDay, 'a day is tagged as a brick');
  assert.deepEqual(brickDay!.brick, { from: 'bike', to: 'run' });
  assert.ok(brickDay!.sessions.bike && brickDay!.sessions.run, 'brick day has both bike and run');
});

// --- G7a: goal-time + feasibility layer on buildTriPlan ----------------------

test('no goal finish time → the plan is volume-only (goalTime/feasibility absent, unchanged)', () => {
  const plan = buildTriPlan(base);
  assert.equal(plan.goalTime, undefined);
  assert.equal(plan.feasibility, undefined);
});

test('goal finish + all three anchors → per-leg targets AND a binding-leg verdict', () => {
  const plan = buildTriPlan({
    ...base,
    anchors: { run: 50, bike: 250, swim: 1.25 },
    riderMassKg: 74,
    goalFinishSeconds: 5 * 3600 + 15 * 60, // sub-5:15
  });
  assert.ok(plan.goalTime, 'decomposition present');
  assert.equal(plan.goalTime!.strategy, 'strength_relative');
  // legs + transitions reconstruct the finish.
  const legSum = plan.goalTime!.legs.swim.targetSeconds + plan.goalTime!.legs.bike.targetSeconds + plan.goalTime!.legs.run.targetSeconds;
  assert.ok(Math.abs(legSum + plan.goalTime!.transitionSeconds - plan.goalTime!.targetFinishSeconds) < 1);
  assert.ok(plan.feasibility, 'feasibility present when all anchors known');
  assert.ok(['ahead', 'on_track', 'stretch', 'unrealistic'].includes(plan.feasibility!.verdict));
  assert.ok(['swim', 'bike', 'run'].includes(plan.feasibility!.bindingLeg));
});

test('goal finish but a missing anchor → decomposition only (typical split), no feasibility', () => {
  const plan = buildTriPlan({
    ...base,
    anchors: { run: 50, swim: 1.25 }, // no FTP
    goalFinishSeconds: 5 * 3600 + 15 * 60,
  });
  assert.ok(plan.goalTime);
  assert.equal(plan.goalTime!.strategy, 'typical_split');
  assert.equal(plan.feasibility, undefined);
});

// --- G7b: schedule relay bakes the real-world layout into the persisted plan --

test('no schedule → placement is the generators’ native day-of-week (identity)', () => {
  const plan = buildTriPlan(base);
  const withNoSchedule = buildTriPlan({ ...base });
  // Same swim day-of-week set both times (nothing re-laid).
  const dows = (p: typeof plan) => p.perSport.swim.flatMap((w) => w.days.filter((d) => d.runType !== 'rest').map((d) => d.dow));
  assert.deepEqual(dows(plan), dows(withNoSchedule));
});

test('schedule relay: swims land ONLY on pool days in the PERSISTED plan', () => {
  const schedule = buildWeekSchedule({ availableDays: [0, 1, 2, 3, 4, 5], poolDays: [1, 3], longDay: 5, defaultMinutes: 100, longDayMinutes: 260 });
  const plan = buildTriPlan({ ...base, schedule });
  for (const wk of plan.perSport.swim) {
    for (const d of wk.days) {
      if (d.runType !== 'rest') assert.ok([1, 3].includes(d.dow), `swim landed on dow ${d.dow}, not a pool day`);
    }
  }
});

test('schedule relay: nothing lands on an unavailable rest day (Sunday)', () => {
  const schedule = buildWeekSchedule({ availableDays: [0, 1, 2, 3, 4, 5], poolDays: [1, 3], longDay: 5 });
  const plan = buildTriPlan({ ...base, schedule });
  for (const d of TRI_DISCIPLINES) {
    for (const wk of plan.perSport[d]) {
      for (const day of wk.days) {
        if (day.runType !== 'rest') assert.notEqual(day.dow, 6, `${d} landed on the protected Sunday`);
      }
    }
  }
});

test('composed week load conserves each sport’s periodized weekly TSS', () => {
  const plan = buildTriPlan(base);
  const composed = composeTriWeeks(plan.perSport);
  assert.equal(composed.length, plan.perSport.bike.length);

  const wk = composed[Math.floor(composed.length / 2)];
  for (const d of TRI_DISCIPLINES) {
    const src = plan.perSport[d].find((w) => w.weekStart === wk.weekStart)!;
    assert.equal(wk.loadBySport[d], src.targetLoadTss ?? 0, `${d} load carried through`);
  }
  assert.equal(
    wk.totalLoad,
    TRI_DISCIPLINES.reduce((s, d) => s + wk.loadBySport[d], 0),
  );
});

test('a bigger hours budget yields more total TSS (monotonic)', () => {
  const small = buildTriPlan({ ...base, weeklyHours: 6 });
  const big = buildTriPlan({ ...base, weeklyHours: 12 });
  assert.ok(big.allocation.totalTss > small.allocation.totalTss);
});
