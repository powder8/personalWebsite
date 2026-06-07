/**
 * Periodization: lay out the build BACKWARD from the goal race date into weekly
 * targets (phase, mesocycle, volume). Volume ramps from start to peak with a
 * down week every 4th week; the taper descends sharply into the race.
 *
 * Deterministic: same inputs → same schedule.
 */
import type { TrainingPhase } from './types';
import { addDays, dayNumber, diffDays } from '../dates';
import { milesToMeters } from './zones';

export interface PeriodizationInput {
  startDay: string; // any day; normalized to the Monday on/after it
  goalRaceDay: string;
  startVolumeMiles: number;
  peakVolumeMiles: number;
  downWeekEvery?: number; // default 4
}

export interface WeekPlan {
  weekStart: string; // Monday
  index: number; // 0-based from start
  weeksToRace: number;
  phase: TrainingPhase;
  cycle: number; // 1-based mesocycle
  targetVolumeMeters: number;
}

/** Day-of-week with Mon=0 … Sun=6. (1970-01-01 was a Thursday = 3.) */
export function dowMon0(iso: string): number {
  return ((dayNumber(iso) % 7) + 3) % 7;
}

/** Monday on or after the given day. */
function mondayOnOrAfter(iso: string): string {
  const dow = dowMon0(iso);
  return dow === 0 ? iso : addDays(iso, 7 - dow);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function periodize(input: PeriodizationInput): WeekPlan[] {
  const downEvery = input.downWeekEvery ?? 4;
  const firstMonday = mondayOnOrAfter(input.startDay);
  const totalWeeks = Math.max(1, Math.floor(diffDays(input.goalRaceDay, firstMonday) / 7));

  // Phase allocation (backward from race). Scales with build length.
  const taperWeeks = Math.min(totalWeeks <= 6 ? 1 : 3, Math.max(1, Math.round(totalWeeks * 0.12)));
  const peakWeeks = totalWeeks <= 6 ? 1 : 2;
  const baseWeeks = Math.max(1, Math.round(totalWeeks * 0.25));
  const buildWeeks = Math.max(0, totalWeeks - taperWeeks - peakWeeks - baseWeeks);

  const phaseAt = (i: number): TrainingPhase => {
    if (i < baseWeeks) return 'base';
    if (i < baseWeeks + buildWeeks) return 'build';
    if (i < baseWeeks + buildWeeks + peakWeeks) return 'peak';
    return 'taper';
  };

  const rampWeeks = baseWeeks + buildWeeks; // weeks over which we ramp to peak
  const weeks: WeekPlan[] = [];

  for (let i = 0; i < totalWeeks; i++) {
    const phase = phaseAt(i);
    const weekStart = addDays(firstMonday, i * 7);
    let volMiles: number;

    if (phase === 'base' || phase === 'build') {
      const t = rampWeeks <= 1 ? 1 : i / (rampWeeks - 1);
      volMiles = lerp(input.startVolumeMiles, input.peakVolumeMiles, t);
      // Down week: every Nth week, back off to absorb the load.
      if ((i + 1) % downEvery === 0) volMiles *= 0.82;
    } else if (phase === 'peak') {
      const peakIdx = i - (baseWeeks + buildWeeks);
      volMiles = input.peakVolumeMiles * (peakIdx === 0 ? 1.0 : 0.95);
    } else {
      // taper: descend toward the race
      const taperIdx = i - (baseWeeks + buildWeeks + peakWeeks);
      const fracs = [0.7, 0.55, 0.4];
      volMiles = input.peakVolumeMiles * (fracs[taperIdx] ?? 0.4);
    }

    weeks.push({
      weekStart,
      index: i,
      weeksToRace: totalWeeks - i,
      phase,
      cycle: Math.floor(i / downEvery) + 1,
      targetVolumeMeters: milesToMeters(Math.round(volMiles * 10) / 10),
    });
  }

  return weeks;
}
