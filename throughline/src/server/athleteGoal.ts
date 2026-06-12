/**
 * Athlete-facing goal setup — a friendly wrapper over setupSeason. The athlete
 * picks one of three paths (finish a distance / hit a time / build fitness),
 * tells us roughly where their fitness is, and we generate a real plan. Keeps
 * an existing fitness anchor (e.g. auto-detected from Strava) when they have
 * one, so they don't have to re-enter it.
 */
import type { DB } from '@/db';
import { setupSeason, type SeasonRaceInput } from '@/server/season';
import { getAthleteVdot } from '@/db/paceConfig';
import { STANDARD_DISTANCES } from '@/engine/plan';

export type GoalKind = 'finish' | 'time' | 'fitness';

/** Distances offered in the athlete goal picker (label → meters). */
export const GOAL_DISTANCES = STANDARD_DISTANCES.filter((d) => ['5K', '10K', 'Half', 'Marathon'].includes(d.label));

export interface AthleteGoalInput {
  kind: GoalKind;
  distanceLabel?: string; // for finish / time
  targetTimeSeconds?: number; // for time
  date?: string; // YYYY-MM-DD — required for finish/time
  /** Where the athlete's fitness is now. 'existing' reuses their current anchor. */
  fitness: { kind: 'existing' | 'race'; distanceLabel?: string; timeSeconds?: number };
  currentWeeklyMiles: number;
  peakWeeklyMiles?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const metersFor = (label: string | undefined) => STANDARD_DISTANCES.find((d) => d.label === label)?.meters;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
const displayDistance = (label: string) => (label === 'Half' ? 'Half Marathon' : label);

export async function setupAthleteGoal(
  db: DB,
  athleteId: string,
  today: string,
  input: AthleteGoalInput,
): Promise<{ weeks: number }> {
  // --- Goal race ---
  let goalRace: SeasonRaceInput;
  if (input.kind === 'fitness') {
    // No race — a base-building block toward a soft checkpoint ~12 weeks out.
    const date = input.date && DATE_RE.test(input.date) ? input.date : addDays(today, 84);
    goalRace = { name: 'Build fitness', date, distanceLabel: '10K', distanceMeters: metersFor('10K'), goalType: 'none' };
  } else {
    const distanceLabel = input.distanceLabel;
    const distanceMeters = metersFor(distanceLabel);
    if (!distanceMeters) throw new Error('Pick a race distance.');
    if (!input.date || !DATE_RE.test(input.date)) throw new Error('Pick your race date (YYYY-MM-DD).');
    if (input.kind === 'time' && !(Number(input.targetTimeSeconds) > 0)) throw new Error('Enter your target time.');
    goalRace = {
      name: displayDistance(distanceLabel!),
      date: input.date,
      distanceLabel,
      distanceMeters,
      goalType: input.kind === 'time' ? 'time' : 'none',
      targetTimeSeconds: input.kind === 'time' ? Math.round(Number(input.targetTimeSeconds)) : undefined,
    };
  }

  // --- Fitness anchor ---
  let fitness: { race?: { distanceMeters: number; timeSeconds: number } } | undefined;
  if (input.fitness.kind === 'race') {
    const m = metersFor(input.fitness.distanceLabel);
    const t = Number(input.fitness.timeSeconds);
    if (!m || !(t > 0)) throw new Error('Enter a recent race distance and time, or choose “use my current fitness”.');
    fitness = { race: { distanceMeters: m, timeSeconds: Math.round(t) } };
  } else {
    // Reuse existing anchor — but make sure one exists.
    const vdot = await getAthleteVdot(db, athleteId);
    if (vdot == null) {
      throw new Error('We don’t have a fitness starting point yet — add a recent race time, or connect Strava first.');
    }
    fitness = undefined; // setupSeason keeps the existing anchor
  }

  // --- Volume ---
  const start = clamp(Math.round(Number(input.currentWeeklyMiles) || 0), 3, 150);
  const peak = input.peakWeeklyMiles
    ? clamp(Math.round(Number(input.peakWeeklyMiles)), start, 160)
    : clamp(Math.round(Math.max(start * 1.3, start + 8)), start, 160);

  const result = await setupSeason(db, athleteId, {
    startDay: today,
    goalRace,
    fitness,
    startVolumeMiles: start,
    peakVolumeMiles: peak,
    // Self-service: there's no coach gate on the athlete's own goal — publish
    // immediately so "this week" and "up today" light up right away.
    publish: true,
  });
  return { weeks: result.weeks };
}
