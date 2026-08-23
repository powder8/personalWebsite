/**
 * Triathlon time-budget allocator (PURE, DB-free — no `server-only`, no clock).
 *
 * The heart of the multi-sport engine: turn a realistic weekly HOURS budget into
 * the swim/bike/run distribution that yields the best race-day result, per
 * `docs/multisport/triathlon-time-optimization-spec.md` (§3–§7).
 *
 * The algorithm is the spec's constrained-greedy heuristic (§7.3), deterministic
 * and explainable ("same inputs → same week"):
 *
 *   1. FLOORS FIRST (§5) — reserve each sport's minimum effective dose (swim's is
 *      frequency-binding for feel; bike/run have maintenance floors). If the
 *      budget can't even cover the floors, scale them down proportionally.
 *   2. DISTRIBUTE THE SURPLUS (§7.3 step 3) by
 *          priority = returnOnTime.yieldPerHour × raceDemand × limiterBoost
 *                     / recoveryCostPerHour
 *      so the bike (half the 70.3 clock, low injury cost) absorbs most marginal
 *      hours, the self-reported limiter gets a boost toward its sport, and run's
 *      high recovery cost keeps it from dominating.
 *   3. CONVERT hours → per-sport weekly TSS-equivalent via each sport's typical
 *      weekly IF (`Load = IF² × hours × 100`, the shared load currency).
 *
 * Output: per-sport weekly TSS budgets (the scalar the periodizer consumes) plus
 * the hours breakdown and a short rationale per sport.
 *
 * ⚠️ TUNABLE CONSTANTS. The hours→TSS IFs, the return-on-time coefficients, the
 * floors and the 70.3 race-demand weights are DEFENSIBLE STARTING VALUES drawn
 * from the spec's sources (Friel; Seiler; Coggan/TrainingPeaks; published
 * race-split distributions), meant to be recalibrated against real cohort data.
 * They are layered global→override exactly like `GlobalPaceModel`.
 */
import type { Discipline, TrainingPhase } from './types';

/** Triathlon race distances the allocator weights for. 70.3 is the primary. */
export type TriDistance = 'sprint' | 'olympic' | '70.3' | 'ironman';

/** The three swim/bike/run disciplines, in a stable order for iteration. */
export const TRI_DISCIPLINES: readonly Discipline[] = ['swim', 'bike', 'run'] as const;

// ---------------------------------------------------------------------------
// Tunable model (global defaults; override per athlete/cohort)
// ---------------------------------------------------------------------------

/**
 * Typical WEEKLY composite intensity factor per sport — the IF that prices a
 * whole mixed week (mostly aerobic + some quality) into TSS via `IF²×h×100`.
 * Run sits highest (impact + the intensity a run week carries), bike mid, swim
 * a shade lower. Tunable; these move the hours→TSS conversion directly.
 */
export const TYPICAL_WEEKLY_IF: Readonly<Record<Discipline, number>> = {
  swim: 0.72,
  bike: 0.75,
  run: 0.78,
};

/**
 * Minimum effective dose per sport (§5), expressed the way the coaching evidence
 * frames it: a sessions-per-week floor AND an hours floor. Swim's BINDING
 * constraint is frequency (feel decays within days; 2 technique/interval swims a
 * week is the maintenance floor, Friel). Bike's is aerobic maintenance; run's
 * protects impact-tolerance so durability never rebuilds from cold (the highest
 * injury-risk ramp). These are LOWER BOUNDS, not targets.
 */
export interface DisciplineFloor {
  minSessionsPerWeek: number;
  minHoursPerWeek: number;
}
export const DEFAULT_FLOORS: Readonly<Record<Discipline, DisciplineFloor>> = {
  swim: { minSessionsPerWeek: 2, minHoursPerWeek: 1.0 },
  bike: { minSessionsPerWeek: 2, minHoursPerWeek: 2.0 },
  run: { minSessionsPerWeek: 2, minHoursPerWeek: 1.5 },
};

/**
 * Return-on-time coefficients (§3.4). `yieldPerHour` ≈ aerobic fitness bought per
 * hour; `recoveryCostPerHour` ≈ the recovery/injury price per hour. Bike is the
 * time-crunched workhorse (high yield, low cost); run's eccentric load is the
 * costliest hour; swim's fitness yield is low (it is governed by its floor, not
 * by these economics — its TIME-yield when technique is the limiter is captured
 * by the limiter boost instead).
 */
export interface ReturnOnTime {
  yieldPerHour: number;
  recoveryCostPerHour: number;
}
export const DEFAULT_RETURN_ON_TIME: Readonly<Record<Discipline, ReturnOnTime>> = {
  swim: { yieldPerHour: 0.5, recoveryCostPerHour: 0.7 },
  bike: { yieldPerHour: 1.0, recoveryCostPerHour: 0.8 },
  run: { yieldPerHour: 0.95, recoveryCostPerHour: 1.3 },
};

/**
 * Race-demand weighting by distance (§4) — where the day is won and lost, not
 * just where the clock is spent. 70.3 (the primary): the bike is ~half the day
 * and the highest-return investable block; the run decides the back half
 * (durability); the swim is the smallest slice and is held at its efficiency
 * floor. Short course flattens toward the three sports mattering more evenly.
 */
export const RACE_DEMAND_WEIGHT: Readonly<Record<TriDistance, Record<Discipline, number>>> = {
  sprint: { swim: 0.9, bike: 1.0, run: 1.05 },
  olympic: { swim: 0.8, bike: 1.1, run: 1.05 },
  '70.3': { swim: 0.6, bike: 1.3, run: 1.1 },
  ironman: { swim: 0.55, bike: 1.3, run: 1.2 },
};

/** How hard the self-reported limiter pulls marginal hours toward its sport (§2.4). */
export const DEFAULT_LIMITER_BOOST = 1.6;

/**
 * Phase load factor — the weekly ramp/recovery cap (§1.4, §3.3). The allocator's
 * budgets are the working (build/peak) target the periodizer ramps toward; base
 * eases in and taper sheds volume. Used when a caller wants a single phase-scaled
 * week; the full-plan path feeds the un-scaled target as the periodizer's peak.
 */
export const PHASE_LOAD_FACTOR: Readonly<Record<TrainingPhase, number>> = {
  base: 0.85,
  build: 1.0,
  peak: 1.0,
  taper: 0.6,
};

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface TriAllocationInput {
  /** Realistic weekly training HOURS budget — the first-class input. */
  weeklyHours: number;
  /** Target race distance. 70.3 / half-iron is the primary. */
  distance: TriDistance;
  /** The athlete's SELF-REPORTED weakest sport (guinea-pig phase; cohort percentiles later). */
  limiter: Discipline;
  /**
   * Per-sport fitness anchors (VDOT / FTP watts / CSS m/s). Informational for the
   * allocation itself (hours→TSS is intensity-relative, not anchor-relative) —
   * carried through so callers/notes can reference them and so the shape matches
   * the spec's `AllocationInput`.
   */
  anchors?: Partial<Record<Discipline, number>>;
  /** Training phase; scales the returned budgets by {@link PHASE_LOAD_FACTOR}. Default 'build' (=1.0). */
  phase?: TrainingPhase;
  /** Override the limiter boost (default {@link DEFAULT_LIMITER_BOOST}). */
  limiterBoost?: number;
  /** Override the floors (default {@link DEFAULT_FLOORS}). */
  floors?: Record<Discipline, DisciplineFloor>;
  /** Override the return-on-time coefficients (default {@link DEFAULT_RETURN_ON_TIME}). */
  returnOnTime?: Record<Discipline, ReturnOnTime>;
  /** Override the typical weekly IF per sport (default {@link TYPICAL_WEEKLY_IF}). */
  typicalWeeklyIf?: Record<Discipline, number>;
  /**
   * Disciplines to allocate across. Default: all three. A phased triathlon that
   * hasn't started swimming yet passes ['bike','run'] so the whole budget goes to
   * the sports actually being trained (excluded sports get a zero budget).
   */
  disciplines?: readonly Discipline[];
}

export interface TriSportBudget {
  /** Weekly hours allocated to this sport. */
  hours: number;
  /** Weekly TSS-equivalent budget (the periodizer's scalar): `IF²×hours×100`. */
  tss: number;
  /** Hours reserved by the minimum-effective-dose floor. */
  floorHours: number;
  /** Hours from the return-on-time surplus distribution (0 when budget only covers floors). */
  surplusHours: number;
  /** The composite weekly IF used to price hours→TSS. */
  typicalIf: number;
  /** Minimum sessions/week the week-builder must satisfy for this sport. */
  minSessionsPerWeek: number;
  /** True when this is the self-reported limiter (received the boost). */
  isLimiter: boolean;
  /** Coach-facing one-liner: floor vs surplus, limiter/demand rationale. */
  rationale: string;
}

export interface TriAllocation {
  distance: TriDistance;
  phase: TrainingPhase;
  /** The input weekly hours (conserved: Σ budgets.hours ≈ this, before phase scaling). */
  weeklyHours: number;
  /** Per-sport weekly TSS budgets + hours breakdown. */
  budgets: Record<Discipline, TriSportBudget>;
  /** Total weekly TSS-equivalent across the three sports. */
  totalTss: number;
  /** True when the budget couldn't cover the floors and they were scaled down. */
  floorsScaled: boolean;
  /** Coach-facing rationale for the whole allocation. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// The allocator
// ---------------------------------------------------------------------------

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Weekly TSS-equivalent from hours at a composite IF: `IF² × hours × 100`. */
export function tssFromHours(hours: number, typicalIf: number): number {
  if (!(hours > 0) || !(typicalIf > 0)) return 0;
  return typicalIf * typicalIf * hours * 100;
}

/**
 * Allocate a weekly hours budget across swim/bike/run for a target race, floors
 * first then surplus-by-return-on-time, and price each sport's hours into a
 * weekly TSS budget. Pure and deterministic.
 */
export function allocateTriBudget(input: TriAllocationInput): TriAllocation {
  const distance = input.distance;
  const phase = input.phase ?? 'build';
  const limiterBoost = input.limiterBoost ?? DEFAULT_LIMITER_BOOST;
  const floors = input.floors ?? DEFAULT_FLOORS;
  const rot = input.returnOnTime ?? DEFAULT_RETURN_ON_TIME;
  const typicalIf = input.typicalWeeklyIf ?? TYPICAL_WEEKLY_IF;
  const demand = RACE_DEMAND_WEIGHT[distance];
  const weeklyHours = Math.max(0, input.weeklyHours);
  const phaseFactor = PHASE_LOAD_FACTOR[phase];
  // The sports we're allocating across (a phased tri may exclude swim).
  const disciplines = input.disciplines ?? TRI_DISCIPLINES;

  const notes: string[] = [];

  // 1) FLOORS FIRST. If the budget can't cover the floors, scale them down
  //    proportionally (a very small week still preserves the sport MIX + skill).
  const totalFloorHours = disciplines.reduce((s, d) => s + floors[d].minHoursPerWeek, 0);
  const floorsScaled = weeklyHours < totalFloorHours;
  const floorScale = floorsScaled && totalFloorHours > 0 ? weeklyHours / totalFloorHours : 1;
  const floorHours: Record<Discipline, number> = { swim: 0, bike: 0, run: 0 };
  for (const d of disciplines) floorHours[d] = floors[d].minHoursPerWeek * floorScale;
  if (floorsScaled) {
    notes.push(
      `Budget (${round1(weeklyHours)} h) is below the swim+bike+run floors (${round1(
        totalFloorHours,
      )} h). Floors scaled to ${Math.round(floorScale * 100)}%, this is a maintenance week; consistency beats heroics.`,
    );
  }

  // 2) SURPLUS by return-on-time × race-demand × limiter-boost / recovery-cost.
  const surplusHours = Math.max(0, weeklyHours - totalFloorHours);
  const priority: Record<Discipline, number> = { swim: 0, bike: 0, run: 0 };
  for (const d of disciplines) {
    const boost = d === input.limiter ? limiterBoost : 1;
    priority[d] = (rot[d].yieldPerHour * demand[d] * boost) / rot[d].recoveryCostPerHour;
  }
  const prioritySum = disciplines.reduce((s, d) => s + priority[d], 0) || 1;

  const hours: Record<Discipline, number> = { swim: 0, bike: 0, run: 0 };
  const surplus: Record<Discipline, number> = { swim: 0, bike: 0, run: 0 };
  for (const d of disciplines) {
    surplus[d] = (surplusHours * priority[d]) / prioritySum;
    hours[d] = floorHours[d] + surplus[d];
  }

  // 3) hours → TSS via each sport's typical weekly IF, phase-scaled. Only the
  //    allocated disciplines get a budget; an excluded sport has none.
  const budgets = {} as Record<Discipline, TriSportBudget>;
  let totalTss = 0;
  for (const d of disciplines) {
    const scaledHours = hours[d] * phaseFactor;
    const tss = Math.round(tssFromHours(scaledHours, typicalIf[d]));
    totalTss += tss;
    const isLimiter = d === input.limiter;
    budgets[d] = {
      hours: round1(hours[d]),
      tss,
      floorHours: round1(floorHours[d]),
      surplusHours: round1(surplus[d]),
      typicalIf: typicalIf[d],
      minSessionsPerWeek: floors[d].minSessionsPerWeek,
      isLimiter,
      rationale: sportRationale(d, distance, isLimiter, floorHours[d], surplus[d], floorsScaled),
    };
  }

  notes.push(allocationHeadline(distance, input.limiter, budgets));

  return {
    distance,
    phase,
    weeklyHours: round1(weeklyHours),
    budgets,
    totalTss,
    floorsScaled,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Rationale strings
// ---------------------------------------------------------------------------

const SPORT_NAME: Record<Discipline, string> = { swim: 'Swim', bike: 'Bike', run: 'Run' };

function sportRationale(
  d: Discipline,
  distance: TriDistance,
  isLimiter: boolean,
  floorH: number,
  surplusH: number,
  floorsScaled: boolean,
): string {
  const parts: string[] = [];
  if (d === 'swim') {
    parts.push(
      isLimiter
        ? 'Your limiter, technique is the highest time-yield fix, so we push swim above its floor with frequent, skill-focused sessions.'
        : `Held near its efficiency floor: swim is only ~10% of a ${distance} and its raw fitness-per-hour is low. Keep the feel for the water (frequency over duration), spend the surplus on the bike.`,
    );
  } else if (d === 'bike') {
    parts.push(
      isLimiter
        ? 'Your limiter, and the biggest investable block: the bike is ~half the day and absorbs load cheaply, so it gets the lion’s share.'
        : 'The workhorse: ~half the race clock, best aerobic return per hour, lowest injury cost, so it gets the largest share of the surplus, and its fitness transfers to the run.',
    );
  } else {
    parts.push(
      isLimiter
        ? 'Your limiter, and where long-course races unravel. Extra run hours, but capped by run’s recovery cost so we build durability without breaking you.'
        : 'Durability decides the back half. Enough run to protect impact-tolerance and race-day durability, but dosed carefully, run is the costliest hour to recover from.',
    );
  }
  parts.push(`(~${round1(floorH)} h floor + ~${round1(surplusH)} h surplus.)`);
  if (floorsScaled) parts.push('Floor scaled to fit a tight week.');
  return parts.join(' ');
}

function allocationHeadline(
  distance: TriDistance,
  limiter: Discipline,
  budgets: Record<Discipline, TriSportBudget>,
): string {
  // Only the sports that actually got a budget (a phased tri may exclude swim).
  const order = TRI_DISCIPLINES.filter((d) => budgets[d]).sort((a, b) => budgets[b].hours - budgets[a].hours);
  const split = order.map((d) => `${SPORT_NAME[d].toLowerCase()} ${budgets[d].hours} h`).join(' / ');
  return `${distance} build: ${split}. ${SPORT_NAME[limiter]} is your self-reported limiter and got the boost; the bike carries the block because it’s half the day at the lowest recovery cost.`;
}
