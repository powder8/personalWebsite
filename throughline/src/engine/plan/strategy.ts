/**
 * The discipline seam.
 *
 * The plan engine's SKELETON is sport-agnostic: periodization phases, weekly
 * load distribution, CTL/ATL/TSB, the readiness/soreness/injury directive
 * overlay. But four pieces are inherently sport-specific — today they are
 * hard-coded for RUNNING, and this interface is where they become pluggable:
 *
 *   1. fitness-anchor resolution — the single scalar that pins fitness
 *      (running: VDOT; cycling: FTP).
 *   2. zones-from-anchor         — the athlete's training zones derived from
 *      that anchor + the global/per-athlete model
 *      (running: pace zones in s/km; cycling: power zones in watts).
 *   3. quality-session prescription — the structured segments (warm-up → main
 *      set → cool-down) and one-line prose for a hard day
 *      (running: reps at pace; cycling: intervals at power).
 *   4. sport-specific feasibility guardrails — "can the athlete reach the goal
 *      in the weeks available?" using a sport's improvement model
 *      (running: Daniels VDOT gain/Riegel; cycling: a power/CTL model).
 *
 * Everything else in the engine is shared and stays put. `runStrategy` (the
 * fully-implemented default) and `bikeStrategy` (a not-yet-implemented stub)
 * both satisfy this interface; `selectStrategy(discipline)` picks one. The
 * engine defaults to `runStrategy`, so existing running behaviour is unchanged.
 */
import type { PaceZones, WorkoutSegment, ZoneKey, Discipline } from './types';
import type { AthletePaceConfig, GlobalPaceModel } from './paceConfig';
import type { GoalFeasibility, GoalFeasibilityInput } from './feasibility';

export interface DisciplineStrategy {
  /** Which sport this strategy implements. */
  readonly discipline: Discipline;

  /**
   * Resolve the athlete's scalar fitness anchor from their config, or null if
   * none can be derived. Running: VDOT (from an explicit VDOT, a race, or a
   * threshold pace). This is the number the feasibility model reasons over —
   * NOT re-derived from the (tweak-carrying) training zones.
   */
  resolveFitnessAnchor(config: AthletePaceConfig): number | null;

  /**
   * Resolve effective training zones from the athlete's config layered on the
   * global model. Throws only when no fitness anchor is available. Running:
   * threshold-anchored pace zones (see zones.ts / vdot.ts / paceConfig.ts).
   */
  resolveZones(config: AthletePaceConfig, global?: GlobalPaceModel): PaceZones;

  /**
   * Structured segments for one quality day — warm-up, the main set scaled to
   * ~`workMiles` at the athlete's own paces/power, then cool-down. `seed` picks
   * a template variant so weeks vary deterministically.
   */
  buildQualitySegments(
    dayMiles: number,
    zone: ZoneKey,
    zones: PaceZones,
    workMiles: number,
    wuCd: number,
    seed: number,
  ): WorkoutSegment[];

  /** One-line prose mirror of the same quality session, in the coach's format. */
  buildQualityDescription(
    dayMiles: number,
    zone: ZoneKey,
    zones: PaceZones,
    workMiles: number,
    wuCd: number,
    seed: number,
  ): string;

  /**
   * Is the athlete's stated goal reachable by race day given where they are and
   * how many weeks remain? Uses a sport-specific improvement model.
   */
  assessGoalFeasibility(input: GoalFeasibilityInput): GoalFeasibility;
}

// Implementations are imported for the registry below. `runStrategy` carries the
// real logic; `bikeStrategy` is a throwing stub until the cycling agents land.
import { runStrategy } from './runStrategy';
import { bikeStrategy } from './bikeStrategy';

/** Pick the strategy for a discipline. Defaults to running at the call sites. */
export function selectStrategy(discipline: Discipline): DisciplineStrategy {
  switch (discipline) {
    case 'run':
      return runStrategy;
    case 'bike':
      return bikeStrategy;
    default: {
      const _exhaustive: never = discipline;
      throw new Error(`selectStrategy: unknown discipline ${String(_exhaustive)}`);
    }
  }
}

export { runStrategy, bikeStrategy };
