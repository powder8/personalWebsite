import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, computeBaseline, diffDays, type DailyReading } from '@/engine';
import {
  assessBody,
  applyAthleteAction,
  prescribe,
  reconcileEpisode,
  returnDaysFor,
  walkVitals,
  type EpisodeState,
  type VitalSeries,
} from '@/engine/body';

// ---- deterministic synthetic athlete ---------------------------------------

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return (s + 1) / 4294967297;
  };
}

const START = '2026-08-01';
interface Shift { from: number; to: number; hrv?: number; rhr?: number; resp?: number; temp?: number; spo2?: number; sleep?: number }

/**
 * `n` days of vitals with REALISTIC night-to-night noise (gaussian; HRV ±12%,
 * resting HR ±2 bpm, breathing ±0.35/min, skin temp ±0.25°C, sleep ±0.8 h),
 * with optional shifted stretches (day indexes).
 */
function athlete(n: number, shifts: Shift[] = [], seed = 7, has: { resp?: boolean } = { resp: true }): VitalSeries {
  const r = rng(seed * 7919 + 1);
  const g = () => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
  const s: Required<Pick<VitalSeries, 'hrv' | 'resting_hr' | 'respiratory_rate' | 'skin_temp' | 'spo2' | 'sleep'>> = {
    hrv: [], resting_hr: [], respiratory_rate: [], skin_temp: [], spo2: [], sleep: [],
  };
  for (let i = 0; i < n; i++) {
    const day = addDays(START, i);
    const sh = shifts.filter((x) => i >= x.from && i <= x.to);
    const sum = (k: keyof Shift) => sh.reduce((a, x) => a + ((x[k] as number | undefined) ?? 0), 0);
    s.hrv.push({ day, value: 55 * (1 + sum('hrv')) * Math.exp(0.12 * g()) });
    s.resting_hr.push({ day, value: 50 + sum('rhr') + 2 * g() });
    if (has.resp) {
      s.respiratory_rate.push({ day, value: 14.6 + sum('resp') + 0.35 * g() });
      s.skin_temp.push({ day, value: 33.8 + sum('temp') + 0.25 * g() });
      s.spo2.push({ day, value: 96.5 + sum('spo2') + 0.7 * g() });
    }
    s.sleep.push({ day, value: Math.max(3, 7.4 + sum('sleep') + 0.8 * g()) });
  }
  return s;
}
const steadyLoad = (n: number, perDay = 60, spike?: { from: number; to: number; mult: number }): DailyReading[] =>
  Array.from({ length: n }, (_, i) => ({
    day: addDays(START, i),
    value: i % 7 === 6 ? 0 : perDay * (spike && i >= spike.from && i <= spike.to ? spike.mult : 1),
  }));
const dayAt = (i: number) => addDays(START, i);

// A three-week illness starting on day 45: the pattern the old engine missed.
const ILLNESS: Shift = { from: 45, to: 65, hrv: -0.25, rhr: 6, resp: 1.2, temp: 0.5, sleep: -0.3 };

// ---- the regression that started this -------------------------------------

test('OLD baseline drifts toward the sick values; the healthy baseline holds', () => {
  const s = athlete(66, [ILLNESS]);
  const day20 = dayAt(64); // 20 days into the illness
  // Old engine: rolling mean/std that includes the sick days.
  const old = computeBaseline(s.resting_hr!, day20);
  assert.ok(old.longMean! >= 51.5, `old "normal" dragged up to ${old.longMean!.toFixed(1)} bpm`);
  assert.ok(old.longStd! >= 3, `old spread inflated to ${old.longStd!.toFixed(1)} bpm`);

  const walk = walkVitals(s, day20);
  const today = walk.days[walk.days.length - 1];
  const rhr = today.vitals.resting_hr!;
  assert.ok(Math.abs(rhr.usual! - 50) < 1.2, `healthy usual still ${rhr.usual!.toFixed(1)} bpm`);
  assert.ok(rhr.hi! - rhr.usual! < 3, 'healthy spread, not inflated by the illness');
  assert.ok(walk.active, 'still inside the episode on sick day 20');
  assert.equal(today.inEpisode, true);
  // Averaged over the last week, the healthy baseline reads the shift about twice as strongly.
  const week = walk.days.slice(-7);
  const newMean = week.reduce((a, d) => a + d.vitals.resting_hr!.bad!, 0) / 7;
  const oldMean = week.reduce((a, d) => a + (d.vitals.resting_hr!.value - old.longMean!) / old.longStd!, 0) / 7;
  assert.ok(newMean > oldMean * 1.6, `new ${newMean.toFixed(1)}σ vs old ${oldMean.toFixed(1)}σ`);
});

test('illness is caught within two days and stays caught for the whole three weeks', () => {
  const s = athlete(66, [ILLNESS]);
  const loads = steadyLoad(66);
  assert.equal(assessBody(s, loads, dayAt(44)).episode, null, 'healthy the day before');
  assert.ok(assessBody(s, loads, dayAt(46)).episode || assessBody(s, loads, dayAt(47)).episode, 'detected by the third sick day');
  for (const i of [48, 52, 58, 62, 65]) {
    const a = assessBody(s, loads, dayAt(i));
    assert.ok(a.episode, `still detected on sick day ${i - 44}`);
    assert.equal(a.episode!.kind, 'illness');
    assert.ok(Math.abs(diffDays(a.episode!.startedOn, dayAt(45))) <= 2, `start ${a.episode!.startedOn}`);
  }
  const late = assessBody(s, loads, dayAt(65)).episode!;
  assert.ok(late.markers.includes('respiratory_rate'), 'breathing rate recognised as an illness marker');
  assert.ok(late.spanDays >= 19);
  assert.equal(late.severity, 'high');
});

test('recovery: signals back in range clears the episode and it appears in history', () => {
  const s = athlete(80, [ILLNESS]);
  const a = assessBody(s, steadyLoad(80), dayAt(72));
  assert.equal(a.episode, null);
  assert.ok(a.clearStreak >= 3);
  assert.equal(a.history.length, 1);
  assert.equal(a.history[0].kind, 'illness');
  assert.ok(Math.abs(diffDays(a.history[0].startedOn, dayAt(45))) <= 2);
  assert.ok(a.history[0].days >= 19 && a.history[0].days <= 25, `${a.history[0].days} days`);
});

test('without breathing-rate or temperature data, sustained unexplained strain still reads as possible illness', () => {
  const s = athlete(60, [{ from: 45, to: 59, hrv: -0.25, rhr: 6 }], 11, { resp: false });
  const a = assessBody(s, steadyLoad(60), dayAt(52));
  assert.ok(a.episode);
  assert.equal(a.episode!.kind, 'illness');
  assert.equal(a.episode!.markers.length, 0);
});

test('one bad night is "strained": no episode, no plan change, and it passes', () => {
  let cleared = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const s = athlete(60, [{ from: 50, to: 50, hrv: -0.35, rhr: 8 }], seed);
    const bad = assessBody(s, steadyLoad(60), dayAt(50));
    assert.equal(bad.episode, null, `seed ${seed}: one night is not an episode`);
    assert.equal(bad.latest!.level, 'abnormal');
    const p = prescribe(null, bad, dayAt(50));
    assert.equal(p.status, 'strained');
    assert.equal(p.actions.length, 0, 'no plan change for one day');
    assert.equal(p.forceEasy, true, 'but today should not be a hard day');
    if (!assessBody(s, steadyLoad(60), dayAt(53)).episode) cleared++;
  }
  assert.ok(cleared >= 8, `${cleared}/10 clear three days later`);
});

test('a healthy athlete is never flagged across 90 days of normal noise', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = athlete(90, [], seed);
    const walk = walkVitals(s, dayAt(89));
    assert.equal(walk.episodes.length + (walk.active ? 1 : 0), 0, `seed ${seed}: a false episode`);
    assert.ok(walk.days.filter((d) => d.level === 'abnormal').length <= 3, `seed ${seed}`);
  }
});

test('strain after a training spike, with no illness markers, reads as overreaching', () => {
  const s = athlete(60, [{ from: 50, to: 59, hrv: -0.2, rhr: 5 }]);
  const loads = steadyLoad(60, 60, { from: 41, to: 52, mult: 1.7 });
  const a = assessBody(s, loads, dayAt(55));
  assert.ok(a.episode);
  assert.equal(a.episode!.kind, 'overreaching');
  assert.ok(a.episode!.leadInLoadRatio! >= 1.3);
});

test('strain with short sleep and normal load reads as under-recovered', () => {
  const s = athlete(58, [{ from: 50, to: 57, hrv: -0.18, rhr: 4, sleep: -1.6 }]);
  const a = assessBody(s, steadyLoad(58), dayAt(52));
  assert.ok(a.episode);
  assert.equal(a.episode!.kind, 'under_recovered');
});

test('a lasting change is accepted as the new normal: at once if the athlete says so, in ~7 weeks if not', () => {
  const s = athlete(125, [{ from: 45, to: 124, rhr: 6, hrv: -0.2 }], 3, { resp: false });
  const loads = steadyLoad(125);
  assert.ok(assessBody(s, loads, dayAt(60)).episode, 'flagged at first');
  // Athlete: "I feel fine" on day 52 → those days count as normal from then on.
  const accepted = assessBody(s, loads, dayAt(75), { accept: [{ from: dayAt(45), to: dayAt(124) }] });
  assert.equal(accepted.episode, null);
  // No answer from the athlete: it self-heals rather than alarming forever.
  assert.equal(assessBody(s, loads, dayAt(124)).episode, null);
});

test('stale data never produces a current call', () => {
  const s = athlete(66, [ILLNESS]);
  const a = assessBody(s, steadyLoad(66), dayAt(70)); // last reading 5 days ago
  assert.equal(a.stale, true);
  assert.equal(a.episode, null);
  assert.equal(prescribe(null, a, dayAt(70)).status, 'unknown');
});

test('steady in-range signals on consistent training → primed, with an OFFER (never an automatic increase)', () => {
  const s = athlete(60, [], 3);
  const a = assessBody(s, steadyLoad(60), dayAt(59), { subjective: { energy: 7 } });
  assert.equal(a.primed, true);
  const p = prescribe(null, a, dayAt(59));
  assert.equal(p.status, 'primed');
  assert.equal(p.actions.length, 0);
  assert.ok(p.asks.some((x) => x.action === 'progress'));
  // Not right after being ill, not when feeling flat, not on a load spike.
  assert.equal(assessBody(s, steadyLoad(60), dayAt(59), { daysSinceEpisodeEnd: 5 }).primed, false);
  assert.equal(assessBody(s, steadyLoad(60), dayAt(59), { subjective: { energy: 3 } }).primed, false);
  assert.equal(assessBody(s, steadyLoad(60, 60, { from: 53, to: 59, mult: 1.6 }), dayAt(59)).primed, false);
});

// ---- lifecycle + prescription ------------------------------------------------

test('lifecycle: suspected → athlete confirms flu → rest → better → staged return → resolved', () => {
  const s = athlete(100, [ILLNESS]);
  const loads = steadyLoad(100);
  let e: EpisodeState | null = null;

  // Day 2 of the illness: suspected, plan held back, athlete asked.
  let today = dayAt(46);
  let a = assessBody(s, loads, today);
  e = reconcileEpisode(e, a, today);
  assert.equal(e!.status, 'suspected');
  let p = prescribe(e, a, today);
  assert.equal(p.status, 'illness_suspected');
  assert.equal(p.actions[0].type, 'recovery_day');
  assert.equal(p.actions[0].safety, true);
  assert.equal(p.question, 'Are you feeling ill?');
  assert.equal(p.forceEasy, true);

  // Athlete: fever and aches → rest.
  e = applyAthleteAction(e, 'sick_systemic', a, today);
  p = prescribe(e, a, today);
  assert.equal(p.status, 'ill');
  assert.equal(p.actions[0].type, 'unavailable');
  assert.deepEqual([p.actions[0].from, p.actions[0].to], [today, addDays(today, 3)]);

  // Still ill a week later: still resting (window rolls forward).
  today = dayAt(53);
  a = assessBody(s, loads, today);
  e = reconcileEpisode(e, a, today);
  assert.equal(e!.status, 'confirmed');
  assert.equal(prescribe(e, a, today).actions[0].from, today);

  // Day 67: signals are clearing; athlete says "I'm better" → return scaled to 3 weeks down.
  today = dayAt(67);
  a = assessBody(s, loads, today);
  e = applyAthleteAction(reconcileEpisode(e, a, today), 'better', a, today);
  assert.equal(e!.status, 'returning');
  assert.equal(e!.returnDays, 14, 'a 3-week systemic illness gets the full 14-day return');
  p = prescribe(e, a, today);
  assert.equal(p.status, 'returning');
  assert.deepEqual(p.actions.map((x) => [x.type, x.factor]), [['recovery_day', 0.5], ['recovery_day', 0.75], ['reduce_volume', 0.9]]);
  assert.equal(p.actions[0].from, today);
  assert.equal(p.actions[2].to, addDays(today, 13));
  assert.equal(p.forceEasy, true);

  // Midway: stage 1 is over, later stages remain; stage 3 allows quality again.
  today = dayAt(78);
  a = assessBody(s, loads, today);
  e = reconcileEpisode(e, a, today);
  p = prescribe(e, a, today);
  assert.deepEqual(p.actions.map((x) => x.factor), [0.9]);
  assert.equal(p.forceEasy, false);

  // After the window: resolved, plan fully restored.
  today = dayAt(82);
  a = assessBody(s, loads, today);
  e = reconcileEpisode(e, a, today);
  assert.equal(e!.status, 'resolved');
  assert.equal(prescribe(e, a, today).actions.length, 0);
});

test('lifecycle: nobody answers → signals clearing still starts a return (never rests forever)', () => {
  const s = athlete(100, [ILLNESS]);
  const loads = steadyLoad(100);
  let e: EpisodeState | null = null;
  for (let i = 46; i <= 72; i++) {
    const a = assessBody(s, loads, dayAt(i));
    e = reconcileEpisode(e, a, dayAt(i));
  }
  assert.equal(e!.status, 'returning');
  assert.ok(e!.clearedOn! >= dayAt(67) && e!.clearedOn! <= dayAt(70));
  assert.equal(e!.returnDays, returnDaysFor('illness', null, 21));
});

test('lifecycle: "I feel fine" leaves the plan alone; a relapse during return goes back to holding', () => {
  const s = athlete(70, [ILLNESS]);
  const loads = steadyLoad(70);
  const today = dayAt(47);
  const a = assessBody(s, loads, today);
  let e = reconcileEpisode(null, a, today);
  e = applyAthleteAction(e, 'fine', a, today);
  assert.equal(e!.status, 'dismissed');
  assert.equal(prescribe(e, a, today).actions.length, 0);
  // Still clearly off a week later → asked once more, not silently overridden twice.
  const later = dayAt(55);
  const a2 = assessBody(s, loads, later);
  e = reconcileEpisode(e, a2, later);
  assert.equal(e!.status, 'suspected');
  assert.equal(e!.reraised, true);

  // Relapse: returning + signals off again.
  const returning: EpisodeState = { ...e!, status: 'returning', report: 'mild', clearedOn: dayAt(51), returnDays: 6 };
  const back = reconcileEpisode(returning, a2, later);
  assert.equal(back!.status, 'confirmed');
  // …but the athlete's "I'm better" is respected for the first days, even with signals still off.
  const justSaid: EpisodeState = { ...returning, clearedOn: dayAt(54) };
  assert.equal(reconcileEpisode(justSaid, a2, later)!.status, 'returning');
  assert.match(prescribe(justSaid, a2, later).body, /still outside your normal range/);
  assert.equal(prescribe(back, a2, later).status, 'ill');
});

test('athlete can report illness with no wearable signal at all', () => {
  const a = assessBody({}, [], '2026-11-10');
  const e = applyAthleteAction(null, 'sick_mild', a, '2026-11-10');
  assert.equal(e!.status, 'confirmed');
  assert.equal(e!.kind, 'illness');
  const p = prescribe(e, a, '2026-11-10');
  assert.equal(p.status, 'ill');
  assert.equal(p.actions[0].factor, 0.5);
  // Two days later "better": too short for a staged return.
  const done = applyAthleteAction(e, 'better', a, '2026-11-11');
  assert.equal(done!.status, 'resolved');
});

test('overreaching: mild backs off intensity; deep or long adds rest days', () => {
  const s = athlete(64, [{ from: 50, to: 63, hrv: -0.3, rhr: 7 }]);
  const loads = steadyLoad(64, 60, { from: 41, to: 55, mult: 1.7 });
  let a = assessBody(s, loads, dayAt(52));
  let e = reconcileEpisode(null, a, dayAt(52));
  let p = prescribe(e, a, dayAt(52));
  assert.equal(p.status, 'overreaching');
  assert.equal(p.actions.some((x) => x.safety), false, 'a coach can approve this one in assisted mode');
  a = assessBody(s, loads, dayAt(60));
  e = reconcileEpisode(e, a, dayAt(60));
  p = prescribe(e, a, dayAt(60));
  assert.deepEqual(p.actions.map((x) => x.type), ['unavailable', 'recovery_day']);
});

// ---- calibration: the numbers that justify the thresholds ---------------------

/** Harsher than real life: correlated HRV/RHR, day-to-day carry-over, 5% wild readings. */
function noisyAthlete(seed: number, n: number, full: boolean, shift?: Shift): VitalSeries {
  const r = rng(seed * 7919 + 1);
  const g = () => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
  const s: VitalSeries = { hrv: [], resting_hr: [], respiratory_rate: [], skin_temp: [], spo2: [], sleep: [] };
  const ar = [0, 0, 0, 0, 0, 0];
  const rho = 0.35;
  const k = Math.sqrt(1 - rho * rho);
  for (let i = 0; i < n; i++) {
    const day = addDays('2025-01-01', i);
    const shared = g();
    const e = [0.7 * shared + 0.71 * g(), 0.7 * shared + 0.71 * g(), g(), g(), g(), g()].map((x) => (r() < 0.05 ? x * 2.5 : x));
    for (let j = 0; j < 6; j++) ar[j] = rho * ar[j] + k * e[j];
    const on = shift && i >= shift.from && i <= shift.to ? shift : null;
    s.hrv!.push({ day, value: 55 * (1 + (on?.hrv ?? 0)) * Math.exp(-0.13 * ar[0]) });
    s.resting_hr!.push({ day, value: 50 + 2.2 * ar[1] + (on?.rhr ?? 0) });
    if (full) {
      s.respiratory_rate!.push({ day, value: 14.6 + 0.4 * ar[2] + (on?.resp ?? 0) });
      s.skin_temp!.push({ day, value: 33.8 + 0.3 * ar[3] + (on?.temp ?? 0) });
      s.spo2!.push({ day, value: 96.5 + 0.8 * ar[4] });
    }
    s.sleep!.push({ day, value: Math.max(3, 7.4 + 0.9 * ar[5]) });
  }
  return s;
}

test('calibration: few false alarms on harsh healthy noise (under ~2.5 per athlete-year)', () => {
  for (const full of [true, false]) {
    let episodes = 0;
    let years = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const w = walkVitals(noisyAthlete(seed, 400, full), addDays('2025-01-01', 399));
      episodes += w.episodes.length + (w.active ? 1 : 0);
      years += 370 / 365;
    }
    const rate = episodes / years;
    assert.ok(rate <= 2.5, `${full ? 'all vitals' : 'HRV/RHR/sleep only'}: ${rate.toFixed(2)} false episodes per athlete-year`);
  }
});

test('calibration: a clear illness is recognised within 3 days for at least 9 in 10 athletes', () => {
  let fast = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const s = noisyAthlete(seed, 125, true, { from: 100, to: 120, hrv: -0.25, rhr: 6, resp: 1.2, temp: 0.5 });
    const w = walkVitals(s, addDays('2025-01-01', 124));
    const hit = [...w.episodes, ...(w.active ? [w.active] : [])].find((e) => e.detectedOn >= addDays('2025-01-01', 100) && e.detectedOn <= addDays('2025-01-01', 102));
    if (hit) fast++;
  }
  assert.ok(fast / N >= 0.9, `${fast}/${N} recognised by sick day 3`);
});

test('calibration: fatigue that only moves HRV and resting HR is still caught within a week, most of the time', () => {
  let caught = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const s = noisyAthlete(seed, 125, true, { from: 100, to: 120, hrv: -0.2, rhr: 5 });
    const w = walkVitals(s, addDays('2025-01-01', 124));
    if ([...w.episodes, ...(w.active ? [w.active] : [])].some((e) => e.detectedOn >= addDays('2025-01-01', 100) && e.detectedOn <= addDays('2025-01-01', 107))) caught++;
  }
  assert.ok(caught / N >= 0.7, `${caught}/${N} caught within 8 days`);
});
