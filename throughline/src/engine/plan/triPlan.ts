/**
 * Multi-sport (triathlon) plan builder (PURE, DB-free — no `server-only`).
 *
 * Composes the three single-sport generators into one triathlon build. It does
 * NOT reimplement periodization or session generation — it feeds each sport its
 * allocated TSS budget (from {@link allocateTriBudget}) through the SAME
 * `periodize({ volumeUnit:'tss' })` ramp + `generateWeek` used by the run/bike/
 * swim paths, then merges the per-sport weeks into a composed triathlon week with
 * a weekly bike→run BRICK (spec §6).
 *
 * Persistence stays pragmatic (spec §8.2, task): each sport's `PlannedWeek[]` is a
 * normal discipline-tagged plan, persisted via the existing `persistPlanDraft`
 * (one plans row per sport per week — the portal already renders discipline-tagged
 * sessions). No new plan schema, no migration.
 */
import type {
  Discipline,
  PlannedWeek,
  PlannedDay,
  TrainingZones,
  TemplateSet,
} from './types';
import { generatePlan } from './index';
import { COACH_TEMPLATE_SET } from './templates';
import { COACH_BIKE_TEMPLATE_SET } from './bikeTemplates';
import { COACH_SWIM_TEMPLATE_SET } from './swimTemplates';
import { isPaceZones } from './powerZonesLogic';
import {
  allocateTriBudget,
  TRI_DISCIPLINES,
  TYPICAL_WEEKLY_IF,
  tssFromHours,
  type TriAllocation,
  type TriAllocationInput,
  type TriDistance,
} from './triAllocatorLogic';
import { decomposeGoalTime, DEFAULT_TRANSITIONS, type GoalDecomposition, type TriAnchors } from './triGoalTimeLogic';
import { assessTriFeasibility, type TriFeasibility } from './triFeasibilityLogic';
import { relayTriPlanToSchedule, type WeekSchedule } from './triScheduleLogic';

/** Default rider mass (kg) for the bike watts↔speed model when the caller
 * hasn't supplied one. Only used when a goal finish time is being decomposed. */
export const DEFAULT_RIDER_MASS_KG = 75;

/** Whole training weeks between two 'YYYY-MM-DD' days (min 1). */
function weeksBetween(startDay: string, endDay: string): number {
  const [sy, sm, sd] = startDay.split('-').map(Number);
  const [ey, em, ed] = endDay.split('-').map(Number);
  const days = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
  return Math.max(1, Math.round(days / 7));
}

/** Start-of-ramp fraction of the peak (allocated) volume the periodizer ramps up from. */
const START_FRACTION = 0.55;

const METERS_PER_MILE = 1609.34;

/**
 * Average training SPEED as a fraction of threshold speed — used only to turn the
 * run leg's allocated HOURS into weekly MILES (the run periodizer's currency,
 * unlike bike/swim which periodize on TSS). A mostly-easy run week averages ~80%
 * of threshold speed. Tunable, alongside the allocator's constants.
 */
const RUN_TRAINING_PACE_RATIO = 0.8;

/** The run leg's average training speed (m/s) from its threshold-anchored zones. */
function runAvgSpeedMetersPerSec(runZones: TrainingZones): number {
  if (!isPaceZones(runZones)) {
    throw new Error('buildTriPlan: run zones must be pace-shaped (PaceZones)');
  }
  const thresholdSpeed = 1000 / runZones.thresholdSecPerKm; // m/s
  return RUN_TRAINING_PACE_RATIO * thresholdSpeed;
}

/** Convert the run leg's weekly hours → weekly miles (its periodizer currency). */
function runWeeklyMilesFromHours(hours: number, runZones: TrainingZones): number {
  const meters = hours * 3600 * runAvgSpeedMetersPerSec(runZones);
  return meters / METERS_PER_MILE;
}

/**
 * Approximate a run week's TSS-equivalent from its planned METRES, so the run leg
 * speaks the same load currency as bike/swim in the composed view. Round-trips
 * the hours→miles conversion, then prices via the run's typical weekly IF — so the
 * peak run week ≈ the allocator's run TSS budget. Additive: never touches the run
 * sessions or persistence (the run leg still stores meters).
 */
function runWeekTssFromMeters(meters: number, runZones: TrainingZones): number {
  if (!(meters > 0)) return 0;
  const hours = meters / (runAvgSpeedMetersPerSec(runZones) * 3600);
  return Math.round(tssFromHours(hours, TYPICAL_WEEKLY_IF.run));
}

/** The default per-discipline template sets, keyed by sport. */
const TEMPLATE_SETS: Record<Discipline, TemplateSet> = {
  run: COACH_TEMPLATE_SET,
  bike: COACH_BIKE_TEMPLATE_SET,
  swim: COACH_SWIM_TEMPLATE_SET,
};

export interface TriPlanInput {
  /** Build start (caller passes "today"). */
  startDay: string;
  /** Goal race day 'YYYY-MM-DD'. */
  goalRaceDay: string;
  /** Target race distance (70.3 primary). */
  distance: TriDistance;
  /** Realistic weekly hours budget. */
  weeklyHours: number;
  /** Self-reported weakest sport. */
  limiter: Discipline;
  /** Resolved training zones per sport (pace / power / CSS). */
  zones: Record<Discipline, TrainingZones>;
  /** Fitness anchors (VDOT/FTP/CSS), carried into the allocation for the record. */
  anchors?: Partial<Record<Discipline, number>>;
  /**
   * Optional TARGET FINISH time (seconds). When set, the plan additionally
   * decomposes it into per-leg race targets + required anchors (§1–§2) and, if
   * all three anchors are present, an honest binding-leg feasibility verdict
   * (§3). Absent → today's volume-only plan, unchanged.
   */
  goalFinishSeconds?: number;
  /** Rider mass (kg) for the bike goal-time model. Defaults to {@link DEFAULT_RIDER_MASS_KG}. */
  riderMassKg?: number;
  /** Athlete age at race day — enables the attainability ceiling in feasibility. */
  ageYears?: number;
  /** Optional per-sport personal bests (raise the ceiling, recency-discounted). */
  personalBests?: Partial<Record<Discipline, { anchor: number; ageAtPB: number }>>;
  /**
   * Real-world weekly schedule (pool days, the long day, per-day minutes). When
   * given, each sport's days are re-laid onto the athlete's actual windows
   * BEFORE persistence. Absent → the generators' naive day-of-week placement.
   */
  schedule?: WeekSchedule;
  /** Override tunables passed straight to {@link allocateTriBudget}. */
  allocationOverrides?: Partial<Omit<TriAllocationInput, 'weeklyHours' | 'distance' | 'limiter' | 'anchors'>>;
  /** Per-discipline template overrides (defaults to the coach sets). */
  templates?: Partial<Record<Discipline, TemplateSet>>;
}

export interface TriPlan {
  allocation: TriAllocation;
  /** The periodized, generated weeks per sport (each a normal discipline plan). */
  perSport: Record<Discipline, PlannedWeek[]>;
  /** The merged multi-sport weeks (one per calendar week), with bricks tagged. */
  weeks: TriWeek[];
  /** Per-leg race targets from the target finish (only when `goalFinishSeconds` was set). */
  goalTime?: GoalDecomposition;
  /** Honest binding-leg verdict + realistic finish (only with a finish target AND all 3 anchors). */
  feasibility?: TriFeasibility;
}

/** A brick session: two disciplines back-to-back on one calendar day (§6). */
export interface TriBrick {
  from: Discipline;
  to: Discipline;
  /** The T2 (bike→run) transition to rehearse, seconds — from DEFAULT_TRANSITIONS. */
  t2Seconds?: number;
}

/** One calendar day of the composed triathlon week: the sport sessions that land on it. */
export interface TriDay {
  day: string; // 'YYYY-MM-DD'
  dow: number; // 0=Mon ... 6=Sun
  /** Non-rest sessions on this day, keyed by discipline. */
  sessions: Partial<Record<Discipline, PlannedDay>>;
  /** When set, the day is a brick — do `to` immediately off `from` (bike→run). */
  brick?: TriBrick;
}

/** A merged multi-sport week: the three disciplines laid across 7 days. */
export interface TriWeek {
  weekStart: string; // Monday
  phase: PlannedWeek['phase'];
  cycle: number;
  days: TriDay[];
  /** Weekly TSS-equivalent per sport (from the generated per-sport weeks). */
  loadBySport: Record<Discipline, number>;
  /** Total weekly TSS-equivalent across the three sports. */
  totalLoad: number;
  /** Whether a bike→run brick was placed this week. */
  hasBrick: boolean;
}

/**
 * Build a full triathlon plan: allocate the hours budget, ramp+generate each
 * sport, and merge into composed weeks with a weekly bike→run brick.
 */
export function buildTriPlan(input: TriPlanInput): TriPlan {
  const allocation = allocateTriBudget({
    weeklyHours: input.weeklyHours,
    distance: input.distance,
    limiter: input.limiter,
    anchors: input.anchors,
    ...input.allocationOverrides,
  });

  // Each sport rides the shared periodize + generateWeek ramp. Bike and swim
  // periodize on weekly TSS; the RUN leg periodizes on weekly MILES (its native
  // currency — kept byte-identical), so its hours budget is converted to miles.
  // The allocated budget is the PEAK volume; we ramp up from START_FRACTION of it.
  const perSport = {} as Record<Discipline, PlannedWeek[]>;
  for (const d of TRI_DISCIPLINES) {
    const peakVolume =
      d === 'run'
        ? runWeeklyMilesFromHours(allocation.budgets.run.hours, input.zones.run)
        : allocation.budgets[d].tss; // read as weekly TSS on bike/swim (volumeUnit tss)
    const weeks = generatePlan(
      {
        startDay: input.startDay,
        goalRaceDay: input.goalRaceDay,
        startVolumeMiles: peakVolume * START_FRACTION,
        peakVolumeMiles: peakVolume,
        discipline: d,
      },
      input.zones[d],
      input.templates?.[d] ?? TEMPLATE_SETS[d],
    );
    // Annotate the run weeks with a TSS-equivalent so the composed view speaks one
    // currency (the run leg itself still stores meters; this is additive metadata).
    if (d === 'run') {
      for (const w of weeks) w.targetLoadTss = runWeekTssFromMeters(w.targetVolumeMeters, input.zones.run);
    }
    perSport[d] = weeks;
  }

  // Real-world schedule: re-lay each sport's days onto the athlete's actual
  // windows (pool days, the long day) so the PERSISTED plan honors them, not
  // just the composed view. No schedule → the generators' native placement.
  const laidPerSport = input.schedule ? relayTriPlanToSchedule(perSport, input.schedule) : perSport;
  const weeks = composeTriWeeks(laidPerSport);

  // Brick transitions (§6): on each brick day, carry the T2 budget to rehearse
  // and annotate the PERSISTED run session so the athlete sees "run off the
  // bike" — the race-specific durability rep, not just two sessions that happen
  // to share a day. Additive to the description; the run's own pace is unchanged.
  const t2 = DEFAULT_TRANSITIONS[input.distance].t2Seconds;
  for (const wk of weeks) {
    const brickDay = wk.days.find((d) => d.brick);
    if (!brickDay?.brick) continue;
    brickDay.brick.t2Seconds = t2;
    const runDay = laidPerSport.run
      .find((w) => w.weekStart === wk.weekStart)
      ?.days.find((d) => d.day === brickDay.day && d.runType !== 'rest');
    if (runDay && !/off the bike/i.test(runDay.description)) {
      runDay.description = `${runDay.description} 🔗 Brick: run straight off the bike, rehearse T2 (~${Math.round(t2)}s).`.trim();
    }
  }

  // Optional goal-time layer: decompose the target finish into per-leg targets,
  // and (when all three anchors are known) an honest binding-leg feasibility.
  // Additive — absent target → the volume-only plan above, unchanged.
  let goalTime: GoalDecomposition | undefined;
  let feasibility: TriFeasibility | undefined;
  if (input.goalFinishSeconds != null) {
    const riderMassKg = input.riderMassKg ?? DEFAULT_RIDER_MASS_KG;
    const anchors: TriAnchors = {
      run: input.anchors?.run ?? 0,
      bike: input.anchors?.bike ?? 0,
      swim: input.anchors?.swim ?? 0,
    };
    goalTime = decomposeGoalTime({
      distance: input.distance,
      targetFinishSeconds: input.goalFinishSeconds,
      anchors,
      riderMassKg,
    });
    if (anchors.run > 0 && anchors.bike > 0 && anchors.swim > 0) {
      feasibility = assessTriFeasibility({
        decomposition: goalTime,
        currentAnchors: anchors,
        weeksToRace: weeksBetween(input.startDay, input.goalRaceDay),
        riderMassKg,
        ageYears: input.ageYears,
        weeklyHours: input.weeklyHours,
        personalBests: input.personalBests,
      });
    }
  }

  return { allocation, perSport: laidPerSport, weeks, goalTime, feasibility };
}

/**
 * Merge the per-sport `PlannedWeek[]` (aligned by `weekStart`) into composed
 * multi-sport weeks, tagging one bike→run brick per week.
 */
export function composeTriWeeks(perSport: Record<Discipline, PlannedWeek[]>): TriWeek[] {
  // Index each sport's weeks by weekStart so we merge the RIGHT calendar weeks
  // (all three periodize off the same start/goal, so the starts line up).
  const byStart = new Map<string, Partial<Record<Discipline, PlannedWeek>>>();
  const order: string[] = [];
  for (const d of TRI_DISCIPLINES) {
    for (const w of perSport[d]) {
      let slot = byStart.get(w.weekStart);
      if (!slot) {
        slot = {};
        byStart.set(w.weekStart, slot);
        order.push(w.weekStart);
      }
      slot[d] = w;
    }
  }
  order.sort((a, b) => a.localeCompare(b));
  return order.map((weekStart) => composeTriWeek(weekStart, byStart.get(weekStart)!));
}

/** Merge one calendar week's per-sport plans into a composed {@link TriWeek}. */
export function composeTriWeek(
  weekStart: string,
  sportWeeks: Partial<Record<Discipline, PlannedWeek>>,
): TriWeek {
  // A representative sport (any present) supplies phase/cycle (all three share them).
  const present = TRI_DISCIPLINES.filter((d) => sportWeeks[d]);
  const rep = sportWeeks[present[0]]!;

  const loadBySport: Record<Discipline, number> = { swim: 0, bike: 0, run: 0 };
  for (const d of TRI_DISCIPLINES) loadBySport[d] = sportWeeks[d]?.targetLoadTss ?? 0;

  // Gather each day's non-rest sessions by dow.
  const days: TriDay[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const sessions: Partial<Record<Discipline, PlannedDay>> = {};
    let day = '';
    for (const d of present) {
      const pd = sportWeeks[d]!.days.find((x) => x.dow === dow);
      if (!pd) continue;
      day = pd.day;
      if (pd.runType !== 'rest') sessions[d] = pd;
    }
    if (!day) continue;
    days.push({ day, dow, sessions });
  }

  // Place ONE bike→run brick (spec §6): the day maximizing combined bike+run load
  // among days where both land — naturally the weekend long day. Do the run off
  // the bike to rehearse the race-specific "jelly legs" transition + durability.
  let brickDay: TriDay | null = null;
  let bestLoad = -1;
  for (const td of days) {
    const bike = td.sessions.bike;
    const run = td.sessions.run;
    if (!bike || !run) continue;
    const combined = (bike.targetLoadTss ?? 0) + (run.targetLoadTss ?? 0) + run.distanceMeters / 1000;
    if (combined > bestLoad) {
      bestLoad = combined;
      brickDay = td;
    }
  }
  if (brickDay) brickDay.brick = { from: 'bike', to: 'run' };

  return {
    weekStart,
    phase: rep.phase,
    cycle: rep.cycle,
    days,
    loadBySport,
    totalLoad: TRI_DISCIPLINES.reduce((s, d) => s + loadBySport[d], 0),
    hasBrick: brickDay != null,
  };
}
