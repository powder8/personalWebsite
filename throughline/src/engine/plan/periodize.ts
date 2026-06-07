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

/** A race the periodizer should structure around. */
export interface KeyRace {
  date: string; // 'YYYY-MM-DD'
  priority: 'goal' | 'tune_up' | 'training';
  label?: string;
}

export interface PeriodizationInput {
  startDay: string; // any day; normalized to the Monday on/after it
  goalRaceDay: string;
  startVolumeMiles: number;
  peakVolumeMiles: number;
  downWeekEvery?: number; // default 4
  /** Interim races between start and the goal. Goal race may be included or not. */
  keyRaces?: KeyRace[];
}

export interface WeekPlan {
  weekStart: string; // Monday
  index: number; // 0-based from start
  weeksToRace: number; // to the goal race
  phase: TrainingPhase;
  cycle: number; // 1-based mesocycle
  targetVolumeMeters: number;
  /** The next key race on/after this week — the race this block builds toward. */
  targetRaceDate: string | null;
  targetRaceLabel: string | null;
  /** A key race falls within this week. */
  raceThisWeek: KeyRace | null;
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
      targetRaceDate: null,
      targetRaceLabel: null,
      raceThisWeek: null,
    });
  }

  applyKeyRaces(weeks, input.keyRaces ?? [], input.goalRaceDay);
  return weeks;
}

const MINI_TAPER = 0.72; // tune-up race week volume multiplier
const POST_RACE_RECOVERY = 0.85; // the week after a tune-up race

/**
 * Tag each week with the race it builds toward and apply mini-tapers around
 * interim (tune-up) races: the race week is sharpened down, the following week
 * eased. The goal race keeps the macro taper already laid out above; training
 * races are run through (tagged, no volume change).
 */
function applyKeyRaces(weeks: WeekPlan[], keyRaces: KeyRace[], goalRaceDay: string): void {
  if (weeks.length === 0) return;
  const races = [...keyRaces].sort((a, b) => a.date.localeCompare(b.date));

  const weekIndexFor = (date: string): number => {
    const d = dayNumber(date);
    for (let i = 0; i < weeks.length; i++) {
      const start = dayNumber(weeks[i].weekStart);
      if (d >= start && d <= start + 6) return i;
    }
    return -1;
  };

  // Tag every week with the next upcoming key race (the block's target).
  for (const w of weeks) {
    const next = races.find((r) => r.date >= w.weekStart) ?? null;
    w.targetRaceDate = next?.date ?? goalRaceDay;
    w.targetRaceLabel = next?.label ?? null;
  }

  // Mark race weeks and apply taper/recovery for tune-up races mid-build.
  for (const r of races) {
    const idx = weekIndexFor(r.date);
    if (idx < 0) continue;
    weeks[idx].raceThisWeek = r;
    if (r.priority === 'tune_up') {
      // Don't fight the goal taper if we're already inside it.
      if (weeks[idx].phase !== 'taper') {
        weeks[idx].targetVolumeMeters = Math.round(weeks[idx].targetVolumeMeters * MINI_TAPER);
        if (idx + 1 < weeks.length && weeks[idx + 1].phase !== 'taper') {
          weeks[idx + 1].targetVolumeMeters = Math.round(
            weeks[idx + 1].targetVolumeMeters * POST_RACE_RECOVERY,
          );
        }
      }
    }
  }
}
