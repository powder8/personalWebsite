import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDebrief, type DebriefInput } from '../runDebriefLogic';
import type { PlannedRef } from '../runFeedbackLogic';

const easy: PlannedRef = { sessionType: 'easy', zone: 'easy', miles: 6, paceFastSecPerKm: 335, paceSlowSecPerKm: 363 };

// Peter's exact scenario: slept poorly, felt off, took breaks, ran trails/fields.
const roughTrailRun: DebriefInput = {
  planned: easy,
  actualMiles: 6,
  actualPaceSecPerKm: 420, // raw looks slow
  gapSecPerKm: 360, // grade-adjusted: actually in the easy band
  movingSeconds: 6 * 420,
  elapsedSeconds: 6 * 420 + 360, // ~6 min stopped
  surface: 'trail',
  climbFeet: 320,
  sleepHours: 5.2,
  sleepNormHours: 7.5,
  energy: 3,
  soreness: 5,
};

test("rough trail run: surfaces sleep, feel, breaks, terrain — and 'showing up' is the win", () => {
  const d = buildDebrief(roughTrailRun);
  const keys = d.signals.map((s) => s.key);
  assert.ok(keys.includes('sleep'), 'detects poor sleep');
  assert.ok(keys.includes('feel'), 'detects low energy/soreness');
  assert.ok(keys.includes('stops'), 'detects mid-run breaks');
  assert.ok(keys.includes('terrain'), 'detects trail/hills');
  assert.ok(keys.includes('showed_up'), 'credits showing up on a rough day');
  assert.match(d.headline, /tough day/i);
  assert.ok(d.wentWell.length >= 2);
  // GAP makes the slow raw pace read as a fair effort, not "too fast/too slow".
  assert.ok(d.wentWell.some((w) => /grade-adjusted|effort/i.test(w)));
});

test('breaks come from elapsed − moving time', () => {
  const noStops = buildDebrief({ ...roughTrailRun, elapsedSeconds: roughTrailRun.movingSeconds });
  assert.ok(!noStops.signals.some((s) => s.key === 'stops'));
});

test('trail pace judged on GAP, not raw (no false "too slow")', () => {
  const d = buildDebrief(roughTrailRun);
  // raw 7:00/mi-ish would look off for easy; GAP 5:47/mi-ish is in band → no caution about being too slow
  assert.ok(!d.focusNext.some((f) => /too slow|slower than/i.test(f)));
});

test('clean day, nailed quality → positive, minimal focus', () => {
  const d = buildDebrief({
    planned: { sessionType: 'threshold', zone: 'threshold', miles: 6, paceFastSecPerKm: 255, paceSlowSecPerKm: 268 },
    actualMiles: 6,
    actualPaceSecPerKm: 261,
    gapSecPerKm: null,
    movingSeconds: 6 * 261,
    elapsedSeconds: 6 * 261,
    surface: 'road',
    climbFeet: 40,
    sleepHours: 8,
    sleepNormHours: 7.5,
    energy: 8,
    soreness: 1,
  });
  assert.match(d.headline, /solid/i);
  assert.ok(d.wentWell.length >= 1);
  assert.ok(d.focusNext.length >= 1); // always at least the "nothing to change" line
});

const cleanRoadRun: DebriefInput = {
  planned: easy,
  actualMiles: 6,
  actualPaceSecPerKm: 348,
  gapSecPerKm: null,
  movingSeconds: 6 * 348,
  elapsedSeconds: 6 * 348,
  surface: 'road',
  climbFeet: 20,
  sleepHours: 8,
  sleepNormHours: 7.5,
  energy: 8,
  soreness: 1,
};

test("athlete's report: 'rough'/unwell → treated as a tough day even with clean sensors", () => {
  const d = buildDebrief({ ...cleanRoadRun, reportedUnwell: true });
  assert.match(d.headline, /tough day/i);
  assert.ok(d.signals.some((s) => s.key === 'feel' && /feeling well/i.test(s.fact)));
  assert.ok(d.wentWell.some((w) => /rough day|hardest part/i.test(w)));
});

test("athlete's report: breaks with no sensor stop still surfaces a Breaks signal", () => {
  const d = buildDebrief({ ...cleanRoadRun, reportedBreaks: true });
  assert.ok(d.signals.some((s) => s.key === 'stops' && /breaks/i.test(s.fact)));
});

test("athlete's report: surface override drives the terrain read (manual run, no sport_type)", () => {
  const d = buildDebrief({ ...cleanRoadRun, surface: null, reportedSurface: 'trail', climbFeet: 250 });
  assert.ok(d.signals.some((s) => s.key === 'terrain' && /trail/i.test(s.fact)));
});

test("athlete's report: 'strong' on a clean day → positive feel + banked win", () => {
  const d = buildDebrief({ ...cleanRoadRun, reportedFeel: 'strong' });
  assert.ok(d.signals.some((s) => s.key === 'feel' && s.polarity === 'positive'));
});

test('easy day run too hard (even on GAP) → caution in focus', () => {
  const d = buildDebrief({
    planned: easy,
    actualMiles: 6,
    actualPaceSecPerKm: 300,
    gapSecPerKm: null,
    movingSeconds: 1800,
    elapsedSeconds: 1800,
    surface: 'road',
    climbFeet: 10,
    sleepHours: 8,
    sleepNormHours: 7.5,
    energy: 8,
    soreness: 1,
  });
  assert.ok(d.focusNext.some((f) => /easy/i.test(f)));
});
