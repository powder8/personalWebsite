/**
 * Seeded synthetic athlete data for the validation harness.
 *
 * Deterministic (seeded PRNG) so runs are reproducible. Generates plausible
 * physiological + subjective series with embedded scenarios the readiness engine
 * SHOULD react to, so the coach can sanity-grade the calls:
 *   - an illness dip (HRV down, resting HR up, sleep down, soreness up)
 *   - a hard training block (load up → fatigue up)
 *   - a taper (load down → recovery)
 */
import { addDays } from '../src/engine/dates';
import type { DailyReading } from '../src/engine/types';

/** mulberry32 — tiny deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number, mean: number, sd: number): number {
  // Box–Muller
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SyntheticAthlete {
  id: string;
  name: string;
  startDay: string;
  days: number;
  hr: { restingHr: number; maxHr: number; sex?: 'M' | 'F' };
  hrv: DailyReading[];
  restingHr: DailyReading[];
  sleep: DailyReading[]; // hours
  soreness: DailyReading[]; // 0-10
  energy: DailyReading[]; // 0-10
  yesterdayRpe: DailyReading[]; // 0-10
  loads: DailyReading[]; // training load per day
  /** Days with a known scenario, for the grader's reference. */
  annotations: Record<string, string>;
}

interface Scenario {
  name: string;
  hrvBase: number;
  rhrBase: number;
  sleepBase: number;
  seed: number;
  sex?: 'M' | 'F';
}

export function makeAthlete(s: Scenario, startDay = '2026-01-01', days = 150): SyntheticAthlete {
  const rand = rng(s.seed);
  const hrv: DailyReading[] = [];
  const restingHr: DailyReading[] = [];
  const sleep: DailyReading[] = [];
  const soreness: DailyReading[] = [];
  const energy: DailyReading[] = [];
  const yesterdayRpe: DailyReading[] = [];
  const loads: DailyReading[] = [];
  const annotations: Record<string, string> = {};

  // Scenario windows (day indices). All placed AFTER the 60-day baseline
  // warmup so the harness actually scores them.
  const hardBlock = { from: 70, to: 92 };
  const illness = { from: 102, to: 108 };
  const taper = { from: 135, to: 149 };

  for (let i = 0; i < days; i++) {
    const day = addDays(startDay, i);
    const inIllness = i >= illness.from && i <= illness.to;
    const inHard = i >= hardBlock.from && i <= hardBlock.to;
    const inTaper = i >= taper.from && i <= taper.to;

    // Physiology, perturbed by scenarios.
    const hrvShift = inIllness ? -12 : inHard ? -3 : inTaper ? +4 : 0;
    const rhrShift = inIllness ? +6 : inHard ? +2 : inTaper ? -2 : 0;
    const sleepShift = inIllness ? -1.4 : 0;

    hrv.push({ day, value: round1(gaussian(rand, s.hrvBase + hrvShift, 4)) });
    restingHr.push({ day, value: Math.round(gaussian(rand, s.rhrBase + rhrShift, 2)) });
    sleep.push({ day, value: round1(clamp(gaussian(rand, s.sleepBase + sleepShift, 0.6), 3, 10)) });

    // Subjective.
    const soreBase = inIllness ? 7 : inHard ? 5 : 2;
    const energyBase = inIllness ? 3 : inHard ? 5 : inTaper ? 8 : 7;
    soreness.push({ day, value: clampInt(Math.round(gaussian(rand, soreBase, 1.2)), 0, 10) });
    energy.push({ day, value: clampInt(Math.round(gaussian(rand, energyBase, 1.2)), 0, 10) });

    // Training: rest during illness, big during hard block, light in taper.
    const isRestDay = i % 7 === 0; // weekly rest
    let load = 0;
    let rpe = 3;
    if (!inIllness && !isRestDay) {
      const baseLoad = inHard ? 90 : inTaper ? 35 : 60;
      load = Math.max(0, gaussian(rand, baseLoad, 18));
      rpe = clampInt(Math.round(gaussian(rand, inHard ? 7 : inTaper ? 4 : 5, 1.2)), 0, 10);
    }
    loads.push({ day, value: round1(load) });
    yesterdayRpe.push({ day, value: rpe });
  }

  annotations[addDays(startDay, illness.from)] = 'illness onset (expect: easy/caution)';
  annotations[addDays(startDay, hardBlock.from)] = 'hard block begins (expect: rising fatigue)';
  annotations[addDays(startDay, taper.from)] = 'taper begins (expect: recovery / go)';

  return {
    id: s.name.toLowerCase().replace(/\s+/g, '-'),
    name: s.name,
    startDay,
    days,
    hr: { restingHr: s.rhrBase, maxHr: 190, sex: s.sex },
    hrv,
    restingHr,
    sleep,
    soreness,
    energy,
    yesterdayRpe,
    loads,
    annotations,
  };
}

export function defaultRoster(): SyntheticAthlete[] {
  return [
    makeAthlete({ name: 'Athlete A', hrvBase: 95, rhrBase: 48, sleepBase: 7.5, seed: 1, sex: 'F' }),
    makeAthlete({ name: 'Athlete B', hrvBase: 70, rhrBase: 55, sleepBase: 6.8, seed: 2, sex: 'M' }),
    makeAthlete({ name: 'Athlete C', hrvBase: 120, rhrBase: 42, sleepBase: 8.1, seed: 3, sex: 'M' }),
  ];
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
