/**
 * PURE same-day run consolidation (no DB). Athletes often log a session as
 * several activities — warm-up, the main effort (a race or workout), and a
 * cool-down. Evaluating "the most recent run" picks the cool-down, which is
 * exactly wrong. This picks the PRIMARY effort and summarizes the day so the
 * coach evaluates the session, not whichever upload happened last.
 */

export interface DayRunLike {
  workoutType: number | null; // Strava: 1 = race, 2 = long run, 3 = workout
  miles: number;
  paceSecPerKm: number | null;
}

/**
 * The run that defines the day's session:
 *  1. a race (workout_type 1) — the whole point of the day
 *  2. else a flagged workout (3)
 *  3. else the longest run
 * Ties break on distance, then on the faster average pace (the harder effort).
 */
export function pickPrimaryRun<T extends DayRunLike>(runs: T[]): T | null {
  if (runs.length === 0) return null;
  const best = (pool: T[]): T =>
    pool.reduce((b, r) => {
      if (r.miles !== b.miles) return r.miles > b.miles ? r : b;
      const rp = r.paceSecPerKm ?? Infinity;
      const bp = b.paceSecPerKm ?? Infinity;
      return rp < bp ? r : b; // faster pace = the harder effort
    });
  const races = runs.filter((r) => r.workoutType === 1);
  if (races.length) return best(races);
  const workouts = runs.filter((r) => r.workoutType === 3);
  if (workouts.length) return best(workouts);
  return best(runs);
}

export interface RunDaySummary {
  count: number;
  totalMiles: number;
  hasRace: boolean;
}

export function summarizeRunDay(runs: DayRunLike[]): RunDaySummary {
  return {
    count: runs.length,
    totalMiles: Math.round(runs.reduce((a, r) => a + r.miles, 0) * 10) / 10,
    hasRace: runs.some((r) => r.workoutType === 1),
  };
}
