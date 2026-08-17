/**
 * TRIATHLON feasibility (spec: docs/multisport/triathlon-goal-time-and-schedule-
 * spec.md, §3) — Stories G3 + G4.
 *
 * G3: a UNIT-AGNOSTIC feasibility core, `assessAnchorFeasibility`, that answers
 * the run engine's question ("can we close the gap from current fitness to the
 * fitness the goal demands, in the weeks we have?") for ANY anchor — VDOT,
 * FTP watts, or CSS m/s — given that anchor's improvement curve and a projector
 * from anchor → race-day time. The run guardrails (`feasibility.ts`) are
 * untouched and stay the run implementation; this is the same *model*
 * generalized, reusing the shared verdict thresholds and taper/gain shape.
 *
 * G4: `assessTriFeasibility` runs the core once per leg against the required
 * anchors from the goal-time decomposition (§2 / triGoalTimeLogic), names the
 * BINDING leg (the sport actually holding the finish back), and sums the
 * projected leg times + transitions into an honest realistic finish — the
 * multi-sport analog of the single-sport goal tracker.
 *
 * Every gain curve here is a coaching heuristic flagged tunable. Running's curve
 * is the best-grounded (Daniels re-testing); the FTP-gain and CSS-gain curves
 * are the least-evidenced pieces and the top cohort-recalibration targets.
 */
import type { Discipline } from './types';
import type { TriDistance } from './triAllocatorLogic';
import type { FeasibilityVerdict } from './feasibility';
import { classifyFeasibility, taperWeeksFor, typicalWeeklyVdotGain, SEASON_GAIN_CAP } from './feasibility';
import type { GoalDecomposition, TriAnchors, TriRaceIntensities, BikeCourseProfile } from './triGoalTimeLogic';
import {
  TRI_DISTANCE_METERS,
  DEFAULT_RACE_INTENSITY,
  DEFAULT_BIKE_COURSE,
  predictSwimSeconds,
  predictBikeSeconds,
  predictRunSeconds,
  predictBikeTimeOnCourse,
  requiredFtpForBikeTime,
  bikeRaceIntensity,
} from './triGoalTimeLogic';
import { assessAttainability } from './attainabilityLogic';

/** Reference weekly training hours a 70.3 gain curve assumes. Fewer hours (a
 * demanding job, a young family) → slower gains; more → faster, to a cap. */
const REFERENCE_WEEKLY_HOURS = 10;
function hoursGainScale(weeklyHours: number | undefined): number {
  if (weeklyHours == null || weeklyHours <= 0) return 1;
  return Math.max(0.5, Math.min(1.15, Math.sqrt(weeklyHours / REFERENCE_WEEKLY_HOURS)));
}

// ── Discipline improvement curves (weekly anchor gain from a focused block) ──

/**
 * FTP gain per focused week (watts), diminishing as FTP rises (a trained
 * cyclist plateaus). ~2.5 W/wk around 200 W, ~1.4 W/wk around 320 W. Tunable —
 * recover from cohort test→retest FTP deltas.
 */
export function typicalWeeklyFtpGain(ftpWatts: number): number {
  // pct/week falls steeply enough that ABSOLUTE watts/week diminish with fitness:
  // ~2.5 W/wk at 200 W (1.25%/wk) → ~1.4 W/wk at 320 W (0.44%/wk).
  const pctPerWeek = Math.max(0.003, Math.min(0.02, 0.026 - ftpWatts * 0.0000675));
  return ftpWatts * pctPerWeek;
}
/** A season's FTP ceiling: ~15% of current FTP. */
export const FTP_SEASON_GAIN_CAP_PCT = 0.15;

/**
 * CSS gain per focused week (m/s). Swimming has big early technique gains that
 * plateau: ~0.014 m/s/wk for a developing 1.0 m/s swimmer, ~0.005 for a 1.5 m/s
 * one. Tunable — the softest of the three curves.
 */
export function typicalWeeklyCssGain(cssMetersPerSec: number): number {
  return Math.max(0.004, 0.024 - cssMetersPerSec * 0.012);
}
/** A season's CSS ceiling (m/s). */
export const CSS_SEASON_GAIN_CAP = 0.12;

// ── Generic anchor feasibility (G3) ──────────────────────────────────────────

export interface AnchorFeasibilityInput {
  currentAnchor: number;
  goalAnchor: number; // the anchor the goal demands (from the decomposition)
  weeksToRace: number;
  taperWeeks: number;
  /** Weekly anchor gain at the CURRENT fitness (from the discipline curve). */
  weeklyGain: number;
  /** Season ceiling on total gain, in the anchor's own units. */
  seasonGainCap: number;
  /** Anchor → predicted race-day LEG time (seconds) at race intensity. */
  projectTime: (anchor: number) => number;
}

export interface AnchorFeasibility {
  verdict: FeasibilityVerdict;
  currentAnchor: number;
  goalAnchor: number;
  gap: number; // goal − current (anchor units); ≤0 = already fast enough
  trainableWeeks: number;
  achievableGain: number; // realistic total gain in the weeks left
  projectedAnchor: number; // realistic race-day anchor
  projectedTimeSeconds: number; // realistic race-day leg time
  requiredWeeklyGain: number; // gain/wk the goal demands (Infinity if no trainable weeks)
  weeksNeededForGoal: number; // weeks a normal build needs to reach the goal
}

const OPTIMISTIC_MULTIPLIER = 1.3; // "everything clicks", matches the run guardrails.

export function assessAnchorFeasibility(input: AnchorFeasibilityInput): AnchorFeasibility {
  const trainableWeeks = Math.max(0, input.weeksToRace - input.taperWeeks);
  const achievableGain = Math.min(input.seasonGainCap, input.weeklyGain * trainableWeeks);
  const optimisticGain = achievableGain * OPTIMISTIC_MULTIPLIER;
  const gap = input.goalAnchor - input.currentAnchor;
  const projectedAnchor = input.currentAnchor + achievableGain;
  const projectedTimeSeconds = input.projectTime(projectedAnchor);
  const requiredWeeklyGain = trainableWeeks > 0 ? gap / trainableWeeks : Infinity;
  const weeksNeededForGoal = gap > 0 ? Math.ceil(gap / input.weeklyGain) + input.taperWeeks : 0;
  return {
    verdict: classifyFeasibility(gap, achievableGain, optimisticGain),
    currentAnchor: input.currentAnchor,
    goalAnchor: input.goalAnchor,
    gap,
    trainableWeeks,
    achievableGain,
    projectedAnchor,
    projectedTimeSeconds,
    requiredWeeklyGain,
    weeksNeededForGoal,
  };
}

// ── Tri aggregate (G4) ───────────────────────────────────────────────────────

export interface TriFeasibilityInput {
  decomposition: GoalDecomposition; // from decomposeGoalTime, carries required anchors + transitions
  currentAnchors: TriAnchors;
  weeksToRace: number;
  riderMassKg: number;
  /**
   * Age at race day. When provided, each leg also gets an ATTAINABILITY ceiling
   * (the "is it possible at all?" check) — a required anchor above the ceiling is
   * 'beyond_reach' regardless of runway. Absent → trajectory-only (as before).
   */
  ageYears?: number;
  /** Total weekly training hours — scales the gain rate (life constraints). */
  weeklyHours?: number;
  /** Optional per-sport personal bests (raise the ceiling, recency-discounted). */
  personalBests?: Partial<Record<Discipline, { anchor: number; ageAtPB: number }>>;
  intensities?: TriRaceIntensities;
  course?: BikeCourseProfile;
}

export interface TriLegFeasibility extends AnchorFeasibility {
  discipline: Discipline;
  requiredWeeklyGainLabel: string; // human, unit-aware (e.g. "2.1 W/wk", "0.31 VDOT/wk")
  /** Best anchor realistically reachable by race day (only when ageYears given). */
  ceiling?: number;
  /** True when the goal for this leg sits above that ceiling (not attainable). */
  aboveCeiling?: boolean;
}

export interface TriFeasibility {
  distance: TriDistance;
  targetFinishSeconds: number;
  /** Σ projected leg times + transitions — the honest "if training goes normally" finish. */
  realisticFinishSeconds: number;
  transitionSeconds: number;
  legs: Record<Discipline, TriLegFeasibility>;
  bindingLeg: Discipline; // the sport actually holding the finish back
  verdict: FeasibilityVerdict; // the binding leg's verdict = the overall verdict
  headline: string;
  note: string;
}

const VERDICT_RANK: Record<FeasibilityVerdict, number> = {
  beyond_reach: 4,
  unrealistic: 3,
  stretch: 2,
  on_track: 1,
  ahead: 0,
};

const UNIT_LABEL: Record<Discipline, string> = { run: 'VDOT', bike: 'W', swim: 'm/s' };

function fmtClock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function assessTriFeasibility(input: TriFeasibilityInput): TriFeasibility {
  const { decomposition: g, currentAnchors, weeksToRace, riderMassKg } = input;
  const d = TRI_DISTANCE_METERS[g.distance];
  const I = input.intensities ?? DEFAULT_RACE_INTENSITY[g.distance];
  const course = input.course ?? DEFAULT_BIKE_COURSE;
  const taper = taperWeeksFor(d.runMeters); // race-day taper keyed off the run leg (the longest single effort)
  const hoursScale = hoursGainScale(input.weeklyHours); // fewer training hours → slower gains

  const legOf = (discipline: Discipline): TriLegFeasibility => {
    const goalAnchor = g.legs[discipline].requiredAnchor;
    let weeklyGain: number;
    let seasonGainCap: number;
    let projectTime: (a: number) => number;
    if (discipline === 'run') {
      weeklyGain = typicalWeeklyVdotGain(currentAnchors.run);
      seasonGainCap = SEASON_GAIN_CAP;
      projectTime = (vdot) => predictRunSeconds(vdot, d.runMeters, I.runBrickFactor);
    } else if (discipline === 'bike') {
      weeklyGain = typicalWeeklyFtpGain(currentAnchors.bike);
      seasonGainCap = currentAnchors.bike * FTP_SEASON_GAIN_CAP_PCT;
      projectTime = (ftp) => predictBikeSeconds(ftp, riderMassKg, d.bikeMeters, I.bikeIntensityFactor, course);
    } else {
      weeklyGain = typicalWeeklyCssGain(currentAnchors.swim);
      seasonGainCap = CSS_SEASON_GAIN_CAP;
      projectTime = (css) => predictSwimSeconds(css, d.swimMeters, I.swimCssFraction);
    }
    const current = currentAnchors[discipline];
    const af = assessAnchorFeasibility({
      currentAnchor: current,
      goalAnchor,
      weeksToRace,
      taperWeeks: taper,
      weeklyGain: weeklyGain * hoursScale,
      seasonGainCap,
      projectTime,
    });
    const rwg = Number.isFinite(af.requiredWeeklyGain) ? af.requiredWeeklyGain : 0;
    const precision = discipline === 'swim' ? 3 : discipline === 'bike' ? 1 : 2;

    // Attainability ceiling: is this even POSSIBLE by race day, ignoring the
    // clock? A required anchor above the ceiling is beyond_reach — more weeks
    // won't fix it. Only when age is known (else trajectory verdict stands).
    let ceiling: number | undefined;
    let aboveCeiling: boolean | undefined;
    let verdict = af.verdict;
    if (input.ageYears != null) {
      const att = assessAttainability({
        discipline,
        currentAnchor: current,
        ageYears: input.ageYears,
        massKg: riderMassKg,
        personalBest: input.personalBests?.[discipline],
      });
      ceiling = att.ceiling;
      aboveCeiling = goalAnchor > att.ceiling;
      if (aboveCeiling) verdict = 'beyond_reach';
    }

    return {
      ...af,
      verdict,
      discipline,
      requiredWeeklyGainLabel: `${rwg.toFixed(precision)} ${UNIT_LABEL[discipline]}/wk`,
      ceiling,
      aboveCeiling,
    };
  };

  const legs = {
    swim: legOf('swim'),
    bike: legOf('bike'),
    run: legOf('run'),
  } as Record<Discipline, TriLegFeasibility>;

  // Binding leg = worst verdict; tie-break by the largest shortfall relative to
  // what a normal build yields (how many "build-blocks" short the leg is).
  const shortfall = (l: AnchorFeasibility) =>
    l.gap <= 0 ? -Infinity : l.achievableGain > 0 ? l.gap / l.achievableGain : Infinity;
  const order: Discipline[] = ['swim', 'bike', 'run'];
  const bindingLeg = order.reduce((worst, disc) => {
    const a = legs[disc];
    const b = legs[worst];
    if (VERDICT_RANK[a.verdict] !== VERDICT_RANK[b.verdict]) {
      return VERDICT_RANK[a.verdict] > VERDICT_RANK[b.verdict] ? disc : worst;
    }
    return shortfall(a) > shortfall(b) ? disc : worst;
  }, order[0]);

  const realisticFinishSeconds =
    legs.swim.projectedTimeSeconds +
    legs.bike.projectedTimeSeconds +
    legs.run.projectedTimeSeconds +
    g.transitionSeconds;

  const verdict = legs[bindingLeg].verdict;
  const { headline, note } = triProse(g, legs, bindingLeg, realisticFinishSeconds);

  return {
    distance: g.distance,
    targetFinishSeconds: g.targetFinishSeconds,
    realisticFinishSeconds,
    transitionSeconds: g.transitionSeconds,
    legs,
    bindingLeg,
    verdict,
    headline,
    note,
  };
}

const DISC_NAME: Record<Discipline, string> = { swim: 'swim', bike: 'bike', run: 'run' };

/** An absolute anchor amount in the leg's native unit: "0.15 m/s" · "79 W" · "6.3 VDOT". */
function absLabel(discipline: Discipline, v: number): string {
  const m = Math.abs(v);
  if (discipline === 'swim') return `${m.toFixed(2)} m/s`;
  if (discipline === 'bike') return `${Math.round(m)} W`;
  return `${m.toFixed(1)} VDOT`;
}

function triProse(
  g: GoalDecomposition,
  legs: Record<Discipline, TriLegFeasibility>,
  bindingLeg: Discipline,
  realisticFinishSeconds: number,
): { headline: string; note: string } {
  const target = fmtClock(g.targetFinishSeconds);
  const realistic = fmtClock(realisticFinishSeconds);
  const b = legs[bindingLeg];
  const name = DISC_NAME[bindingLeg];

  switch (b.verdict) {
    case 'ahead':
      return {
        headline: `${target} is within reach`,
        note: `Every leg is at or ahead of the fitness ${target} needs, the plan is about race-specific sharpening and durability (especially the run off the bike), not chasing big fitness gains. Realistic finish on a normal build: ~${realistic}.`,
      };
    case 'on_track':
      return {
        headline: `${target} is on track`,
        note: `Your ${name} is the leg that has to move most (needs ~${b.requiredWeeklyGainLabel}), and a solid ${b.trainableWeeks}-week block at your level gets there. Stay consistent across all three and ~${realistic} is a realistic finish.`,
      };
    case 'stretch':
      return {
        headline: `${target} is a stretch. The ${name} is the constraint`,
        note: `The ${name} needs about ${b.requiredWeeklyGainLabel} for ${b.trainableWeeks} weeks, the top of what typically happens, not the expectation. It's the leg that decides your day. Realistic finish on a normal build: ~${realistic}; treat that as success and ${target} as the reach.`,
      };
    case 'unrealistic': {
      // POSSIBLE but not in these weeks — the gap is under the athlete's ceiling
      // (or ceiling unknown), just beyond what this build's runway/hours yield.
      const gapLabel = absLabel(bindingLeg, b.gap);
      const addsLabel = absLabel(bindingLeg, b.achievableGain);
      return {
        headline: `${target} is a longer game. The ${name} needs more time`,
        note: `${target} is reachable for you, but not in this build: these ${b.trainableWeeks} training weeks realistically add ~${addsLabel} on the ${name}, and it needs about ${gapLabel} more (${absLabel(bindingLeg, b.currentAnchor)} → ${absLabel(bindingLeg, b.goalAnchor)}). Give the ${name} another season or two of consistent work and it comes in range, for THIS race, ~${realistic} is a strong, honest target.`,
      };
    }
    default: {
      // beyond_reach: the goal for the binding leg sits above the athlete's
      // age-graded ceiling — more time or hours won't get there. Be honest AND
      // kind: it's an elite time for the profile, not a personal failing.
      const ceilingLabel = b.ceiling != null ? absLabel(bindingLeg, b.ceiling) : null;
      return {
        headline: `${target} is faster than this race can be for you`,
        note: `${target} is an elite time, on the ${name} it would need ${absLabel(bindingLeg, b.goalAnchor)}, past what's realistically attainable for your profile${ceilingLabel ? ` (a best-case ceiling around ${ceilingLabel})` : ''}, even with unlimited time. That's no knock on you, it's simply a very fast number. The honest, motivating target for this race is ~${realistic}, and it's a genuinely strong day. Let's chase that.`,
      };
    }
  }
}

// ── Standalone cycling: FTP-goal feasibility (bike goal tracker) ─────────────

export interface FtpGoalInput {
  currentFtp: number;
  targetFtp: number;
  weeksToRace: number;
  ageYears?: number; // enables the attainability ceiling
  massKg?: number; // for the age-graded bounding box
  weeklyHours?: number; // scales the gain rate
}

export interface FtpGoalAssessment {
  verdict: FeasibilityVerdict;
  currentFtp: number;
  targetFtp: number;
  projectedFtp: number; // realistic FTP by the event, on a normal build
  gapWatts: number;
  requiredWeeklyGain: number; // W/wk the goal demands
  ceiling?: number; // best-case attainable FTP (when age known)
  aboveCeiling: boolean;
}

/**
 * Is a target FTP reachable by the event? The cycling analog of the run goal
 * tracker's verdict — reuses the shared anchor-feasibility core (FTP gain curve,
 * hours scaling) + the attainability ceiling (age/mass), so a goal above what's
 * realistically attainable reads `beyond_reach`, not just "hard".
 */
export function assessFtpGoal(input: FtpGoalInput): FtpGoalAssessment {
  const taper = 2; // a short sharpening/taper into the event
  const af = assessAnchorFeasibility({
    currentAnchor: input.currentFtp,
    goalAnchor: input.targetFtp,
    weeksToRace: input.weeksToRace,
    taperWeeks: taper,
    weeklyGain: typicalWeeklyFtpGain(input.currentFtp) * hoursGainScale(input.weeklyHours),
    seasonGainCap: input.currentFtp * FTP_SEASON_GAIN_CAP_PCT,
    projectTime: (a) => a, // identity. "projected time" IS the projected FTP here
  });

  let verdict = af.verdict;
  let ceiling: number | undefined;
  let aboveCeiling = false;
  if (input.ageYears != null) {
    const att = assessAttainability({
      discipline: 'bike',
      currentAnchor: input.currentFtp,
      ageYears: input.ageYears,
      massKg: input.massKg,
    });
    ceiling = att.ceiling;
    aboveCeiling = input.targetFtp > att.ceiling;
    if (aboveCeiling) verdict = 'beyond_reach';
  }

  return {
    verdict,
    currentFtp: input.currentFtp,
    targetFtp: input.targetFtp,
    projectedFtp: Math.round(af.projectedAnchor),
    gapWatts: Math.round(input.targetFtp - input.currentFtp),
    requiredWeeklyGain: Number.isFinite(af.requiredWeeklyGain) ? Number(af.requiredWeeklyGain.toFixed(1)) : 0,
    ceiling: ceiling != null ? Math.round(ceiling) : undefined,
    aboveCeiling,
  };
}

// ── Standalone cycling: RACE finish-time feasibility (distance + elevation) ──

export interface BikeRaceGoalInput {
  currentFtp: number;
  targetTimeSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  riderMassKg: number;
  weeksToRace: number;
  ageYears?: number;
  weeklyHours?: number;
  /** Race intensity (IF); defaults from the target duration. */
  intensityFactor?: number;
}

export interface BikeRaceGoalAssessment {
  verdict: FeasibilityVerdict;
  currentFtp: number;
  requiredFtp: number; // FTP the target time demands ON THIS COURSE
  projectedFtp: number; // realistic FTP by race day
  projectedTimeSeconds: number; // realistic finish on a normal build
  targetTimeSeconds: number;
  gapWatts: number;
  requiredWeeklyGain: number;
  ceiling?: number;
  aboveCeiling: boolean;
}

/**
 * Is a target FINISH TIME plausible on a specific course? Inverts the elevation-
 * aware course model to the FTP the time demands, then runs the shared
 * feasibility core (FTP gain + hours) + attainability ceiling — so the projector
 * returns a real finish TIME and the verdict is honest about a hilly course.
 */
export function assessBikeRaceGoal(input: BikeRaceGoalInput): BikeRaceGoalAssessment {
  const IF = input.intensityFactor ?? bikeRaceIntensity(input.targetTimeSeconds);
  const requiredFtp = requiredFtpForBikeTime(
    input.targetTimeSeconds,
    input.riderMassKg,
    input.distanceMeters,
    input.elevationGainMeters,
    IF,
  );
  const projectTime = (ftp: number) =>
    predictBikeTimeOnCourse(ftp, input.riderMassKg, input.distanceMeters, input.elevationGainMeters, IF);

  const af = assessAnchorFeasibility({
    currentAnchor: input.currentFtp,
    goalAnchor: requiredFtp,
    weeksToRace: input.weeksToRace,
    taperWeeks: 2,
    weeklyGain: typicalWeeklyFtpGain(input.currentFtp) * hoursGainScale(input.weeklyHours),
    seasonGainCap: input.currentFtp * FTP_SEASON_GAIN_CAP_PCT,
    projectTime,
  });

  let verdict = af.verdict;
  let ceiling: number | undefined;
  let aboveCeiling = false;
  if (input.ageYears != null) {
    const att = assessAttainability({
      discipline: 'bike',
      currentAnchor: input.currentFtp,
      ageYears: input.ageYears,
      massKg: input.riderMassKg,
    });
    ceiling = att.ceiling;
    aboveCeiling = requiredFtp > att.ceiling;
    if (aboveCeiling) verdict = 'beyond_reach';
  }

  return {
    verdict,
    currentFtp: input.currentFtp,
    requiredFtp,
    projectedFtp: Math.round(af.projectedAnchor),
    projectedTimeSeconds: af.projectedTimeSeconds,
    targetTimeSeconds: input.targetTimeSeconds,
    gapWatts: Math.round(requiredFtp - input.currentFtp),
    requiredWeeklyGain: Number.isFinite(af.requiredWeeklyGain) ? Number(af.requiredWeeklyGain.toFixed(1)) : 0,
    ceiling: ceiling != null ? Math.round(ceiling) : undefined,
    aboveCeiling,
  };
}
