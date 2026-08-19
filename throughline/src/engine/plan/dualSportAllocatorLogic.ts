/**
 * Dual-sport (run + bike) weekly-hours allocator (PURE, DB-free).
 *
 * When an athlete pursues an independent RUN goal and an independent BIKE goal at
 * the same time, we don't want two full-time plans stacked on top of each other —
 * that's the "overlapping goals that are too time consuming" trap. Instead the
 * athlete owns ONE realistic weekly-hours budget, and this splits it across the
 * active disciplines so the combined load stays sane.
 *
 * It reuses the triathlon allocator's shape and its tuned constants (floors +
 * return-on-time), minus the tri-race-distance demand weighting (there is no
 * single race here — two separate goals):
 *
 *   1. FLOORS FIRST — reserve each active sport's minimum effective dose so
 *      neither goal starves. If the budget can't cover the floors, scale them
 *      down proportionally (a maintenance week that still keeps both sports live).
 *   2. SURPLUS BY DEMAND — distribute the remaining hours by
 *          priority = returnOnTime.yieldPerHour / recoveryCostPerHour × boost
 *      so the bike (high yield, low recovery cost) absorbs more marginal hours and
 *      the run's high eccentric cost keeps it from dominating — exactly the tri
 *      economics. The athlete's A-goal (`priority`) gets a boost toward its sport.
 *
 * One active discipline → it simply gets the whole budget. Pure and deterministic.
 */
import type { Discipline } from './types';
import { DEFAULT_FLOORS, DEFAULT_RETURN_ON_TIME, type DisciplineFloor, type ReturnOnTime } from './triAllocatorLogic';

/** The disciplines this allocator coordinates (swimming stays in the tri path). */
export type DualDiscipline = 'run' | 'bike';
export const DUAL_DISCIPLINES: readonly DualDiscipline[] = ['run', 'bike'] as const;

/** How hard the athlete's A-goal pulls marginal hours toward its sport. */
export const DEFAULT_PRIORITY_BOOST = 1.4;

export interface DualSportAllocationInput {
  /** The athlete's realistic TOTAL weekly training hours — the shared budget. */
  weeklyHours: number;
  /** Which sports have a live goal right now (1 or 2 of run/bike). */
  disciplines: readonly DualDiscipline[];
  /** The A-goal, if the athlete named one — it gets the priority boost. */
  priority?: DualDiscipline;
  /** Override the priority boost (default {@link DEFAULT_PRIORITY_BOOST}). */
  priorityBoost?: number;
  /** Override the floors (default: run/bike from the tri allocator's floors). */
  floors?: Record<DualDiscipline, DisciplineFloor>;
  /** Override the return-on-time coefficients (default: tri allocator's). */
  returnOnTime?: Record<DualDiscipline, ReturnOnTime>;
}

export interface DualSportBudget {
  /** Weekly hours allocated to this sport. */
  hours: number;
  /** Hours reserved by the minimum-effective-dose floor. */
  floorHours: number;
  /** Hours from the surplus (return-on-time) distribution. */
  surplusHours: number;
  /** Minimum sessions/week for this sport. */
  minSessionsPerWeek: number;
  /** True when this is the athlete's A-goal (received the boost). */
  isPriority: boolean;
  /** Coach-facing one-liner. */
  rationale: string;
}

export interface DualSportAllocation {
  /** The input weekly hours (conserved: Σ budgets.hours ≈ this). */
  weeklyHours: number;
  /** Per-active-sport weekly hours breakdown. */
  budgets: Partial<Record<DualDiscipline, DualSportBudget>>;
  /** True when the budget couldn't cover the floors and they were scaled down. */
  floorsScaled: boolean;
  /** Coach-facing rationale for the split. */
  notes: string[];
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Split a weekly-hours budget across the athlete's active run/bike goals, floors
 * first then surplus by return-on-time. Pure and deterministic.
 */
export function allocateDualSportHours(input: DualSportAllocationInput): DualSportAllocation {
  const boost = input.priorityBoost ?? DEFAULT_PRIORITY_BOOST;
  const floors = input.floors ?? { run: DEFAULT_FLOORS.run, bike: DEFAULT_FLOORS.bike };
  const rot = input.returnOnTime ?? { run: DEFAULT_RETURN_ON_TIME.run, bike: DEFAULT_RETURN_ON_TIME.bike };
  const weeklyHours = Math.max(0, input.weeklyHours);

  // Dedup + keep only run/bike, in a stable order.
  const active = DUAL_DISCIPLINES.filter((d) => input.disciplines.includes(d));
  const notes: string[] = [];

  if (active.length === 0) {
    return { weeklyHours, budgets: {}, floorsScaled: false, notes: ['No active run/bike goal to allocate.'] };
  }

  // 1) FLOORS FIRST. Scale down proportionally if the budget can't cover them.
  const totalFloorHours = active.reduce((s, d) => s + floors[d].minHoursPerWeek, 0);
  const floorsScaled = weeklyHours < totalFloorHours;
  const floorScale = floorsScaled && totalFloorHours > 0 ? weeklyHours / totalFloorHours : 1;
  if (floorsScaled) {
    notes.push(
      `Budget (${round1(weeklyHours)} h) is below the ${active.join('+')} floors (${round1(
        totalFloorHours,
      )} h). Floors scaled to ${Math.round(floorScale * 100)}% — a maintenance week; keep both sports ticking over.`,
    );
  }

  // 2) SURPLUS by return-on-time × priority boost.
  const surplusHours = Math.max(0, weeklyHours - totalFloorHours);
  const priority = {} as Record<DualDiscipline, number>;
  for (const d of active) {
    const b = d === input.priority ? boost : 1;
    priority[d] = (rot[d].yieldPerHour * b) / rot[d].recoveryCostPerHour;
  }
  const prioritySum = active.reduce((s, d) => s + priority[d], 0) || 1;

  const budgets: Partial<Record<DualDiscipline, DualSportBudget>> = {};
  for (const d of active) {
    const floorHours = floors[d].minHoursPerWeek * floorScale;
    const surplus = (surplusHours * priority[d]) / prioritySum;
    const hours = floorHours + surplus;
    const isPriority = d === input.priority;
    budgets[d] = {
      hours: round1(hours),
      floorHours: round1(floorHours),
      surplusHours: round1(surplus),
      minSessionsPerWeek: floors[d].minSessionsPerWeek,
      isPriority,
      rationale: floorsScaled
        ? `${round1(hours)} h — maintenance floor only.`
        : `${round1(hours)} h (${round1(floorHours)} h floor + ${round1(surplus)} h by demand${
            isPriority ? ', A-goal boosted' : ''
          }).`,
    };
  }

  if (!floorsScaled && active.length > 1) {
    const parts = active.map((d) => `${d} ${round1(budgets[d]!.hours)} h`);
    notes.push(
      `${round1(weeklyHours)} h/week split by training demand: ${parts.join(', ')}.` +
        (input.priority ? ` Your ${input.priority} goal is the A-priority.` : ''),
    );
  }

  return { weeklyHours, budgets, floorsScaled, notes };
}
