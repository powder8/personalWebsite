/**
 * TRIATHLON GOAL-TIME predictors + decomposition (spec: docs/multisport/
 * triathlon-goal-time-and-schedule-spec.md, §1–§2).
 *
 * Story G1 (this file, predictors): given an athlete's own anchors (VDOT / FTP /
 * CSS), how long does each leg take at a *sustainable race intensity*? Pure
 * physics/physiology — no DB, no engine coupling. These reference times are the
 * raw material the decomposition (G2, below) scales to a target finish.
 *
 * Every constant here is a DEFENSIBLE STARTING VALUE flagged tunable — the
 * guinea-pig cohort recalibrates them (bike CdA/Crr is the single biggest
 * calibration target: a wrong CdA skews every bike target and its feasibility).
 * Sources: Daniels (run, via vdot.ts), Wakayoshi/Ginn CSS (swim, via cssLogic),
 * Martin et al. 1998 (bike power model), Allen & Coggan (race IF), Friel (brick).
 */
import type { Discipline } from './types';
import type { TriDistance } from './triAllocatorLogic';
import { predictRaceTimeSeconds, vdotFromRace } from './vdot';

/** Per-leg race distances (metres). 70.3 is the primary target. */
export interface TriRaceDistances {
  swimMeters: number;
  bikeMeters: number;
  runMeters: number;
}
export const TRI_DISTANCE_METERS: Readonly<Record<TriDistance, TriRaceDistances>> = {
  sprint: { swimMeters: 750, bikeMeters: 20000, runMeters: 5000 },
  olympic: { swimMeters: 1500, bikeMeters: 40000, runMeters: 10000 },
  '70.3': { swimMeters: 1900, bikeMeters: 90000, runMeters: 21097.5 },
  ironman: { swimMeters: 3800, bikeMeters: 180000, runMeters: 42195 },
};

/**
 * Sustainable race intensity per leg, as a fraction of the sport's anchor,
 * for the given distance. Longer races → lower fraction (you hold less of
 * threshold the longer you go). Tunable per cohort.
 *  - swim: fraction of CSS velocity held in open water (drafting/sighting cost).
 *  - bike: Intensity Factor = raceWatts / FTP (Coggan 70.3 range ~0.78–0.83).
 *  - run: the run leg is priced by the brick factor below, not a %VDOT (the
 *    VDOT predictor already gives an all-out equivalent; the brick factor
 *    slows it for running off the bike), so `run` here is unused (kept for
 *    shape symmetry / future non-brick use).
 */
export interface TriRaceIntensities {
  swimCssFraction: number;
  bikeIntensityFactor: number;
  runBrickFactor: number; // >1 slows the run: "jelly legs" off the bike (Millet 2009)
}
export const DEFAULT_RACE_INTENSITY: Readonly<Record<TriDistance, TriRaceIntensities>> = {
  sprint: { swimCssFraction: 0.97, bikeIntensityFactor: 0.92, runBrickFactor: 1.02 },
  olympic: { swimCssFraction: 0.94, bikeIntensityFactor: 0.85, runBrickFactor: 1.03 },
  '70.3': { swimCssFraction: 0.9, bikeIntensityFactor: 0.8, runBrickFactor: 1.05 },
  ironman: { swimCssFraction: 0.85, bikeIntensityFactor: 0.7, runBrickFactor: 1.08 },
};

// ── Swim ────────────────────────────────────────────────────────────────────

/**
 * Predict swim leg seconds. CSS is a velocity (m/s); race pace is a fraction of
 * it (open-water sighting/drafting cost < 1). time = distance / (fraction·CSS).
 */
export function predictSwimSeconds(cssMetersPerSec: number, meters: number, cssFraction: number): number {
  if (cssMetersPerSec <= 0 || meters <= 0) return 0;
  const v = cssFraction * cssMetersPerSec;
  return Math.round(meters / v);
}

// ── Bike (Martin et al. 1998 forward power model, flat/steady) ───────────────

/**
 * Physical + course parameters for the watts↔speed conversion. Defaults are a
 * mid-pack age-grouper on a road bike (hoods) on a flat/rolling course. The
 * cohort recalibrates CdA/Crr per athlete from ride files (power+speed+grade).
 */
export interface BikeCourseProfile {
  cda: number; // effective drag area CdA (m²): ~0.32 road/hoods, ~0.26 aerobars/TT
  crr: number; // coefficient of rolling resistance: ~0.005 good road tyres
  airDensityKgM3: number; // ρ: ~1.225 at sea level, 15 °C
  drivetrainLoss: number; // fraction lost in the drivetrain: ~0.02
  bikeMassKg: number; // bike + kit
  gradeFraction: number; // net course grade (rise/run); 0 = flat. A 70.3's net is ~0.
}
export const DEFAULT_BIKE_COURSE: BikeCourseProfile = {
  cda: 0.35, // road bike on the hoods; drops to ~0.26 on aerobars/TT. The #1 cohort-calibration target.
  crr: 0.005,
  airDensityKgM3: 1.225,
  drivetrainLoss: 0.02,
  bikeMassKg: 8.5,
  gradeFraction: 0,
};

const G = 9.80665;

/**
 * Leg power (watts) required to hold ground speed `v` (m/s) under the profile —
 * the Martin 1998 forward model: gravity + rolling + aero, divided out by
 * drivetrain efficiency. Monotonically increasing in v, so its inverse is a
 * clean binary search. `riderMassKg` is the rider only; bike mass is in profile.
 */
export function bikePowerForSpeed(v: number, riderMassKg: number, profile: BikeCourseProfile): number {
  const m = riderMassKg + profile.bikeMassKg;
  const sinTheta = profile.gradeFraction / Math.sqrt(1 + profile.gradeFraction * profile.gradeFraction);
  const fGravity = m * G * sinTheta;
  const fRolling = m * G * profile.crr * Math.cos(Math.atan(profile.gradeFraction));
  const fAero = 0.5 * profile.airDensityKgM3 * profile.cda * v * v;
  const wheelPower = (fGravity + fRolling + fAero) * v;
  return wheelPower / (1 - profile.drivetrainLoss);
}

/** Invert the power model: ground speed (m/s) sustainable at a steady `watts`. */
export function bikeSpeedForPower(watts: number, riderMassKg: number, profile: BikeCourseProfile): number {
  if (watts <= 0) return 0;
  let lo = 0.1; // m/s
  let hi = 30; // m/s (well above any human)
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bikePowerForSpeed(mid, riderMassKg, profile) < watts) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Predict bike leg seconds. raceWatts = FTP · IF; convert to a steady speed via
 * the power model, then time = distance / speed.
 */
export function predictBikeSeconds(
  ftpWatts: number,
  riderMassKg: number,
  meters: number,
  intensityFactor: number,
  profile: BikeCourseProfile = DEFAULT_BIKE_COURSE,
): number {
  if (ftpWatts <= 0 || meters <= 0) return 0;
  const raceWatts = ftpWatts * intensityFactor;
  const v = bikeSpeedForPower(raceWatts, riderMassKg, profile);
  return v > 0 ? Math.round(meters / v) : 0;
}

/**
 * Average grade a course's CLIMBING is done at. The elevation-aware time model
 * assumes total climb `E` happens at this grade over `E/grade` metres (the rest
 * of the course is ridden ~flat). Tunable — steeper ⇒ slower climbing ⇒ a bigger
 * elevation penalty. 6% is a fair average for real climbs.
 */
export const DEFAULT_AVG_CLIMB_GRADE = 0.06;

/** Bike race intensity (IF) from the target duration — shorter efforts hold a
 * higher fraction of threshold. Tunable. */
export function bikeRaceIntensity(targetSeconds: number): number {
  const h = targetSeconds / 3600;
  if (h <= 1) return 0.9; // ~40k TT
  if (h <= 2.5) return 0.82;
  if (h <= 4.5) return 0.75;
  return 0.7; // long fondo / ultra
}

/**
 * Predict a bike course finish time (seconds) accounting for TOTAL CLIMBING, not
 * just net grade — a hilly loop is slower than a flat one at the same net grade,
 * because time lost climbing isn't recovered on the descents. Splits the course:
 * `E/avgClimbGrade` metres are ridden at that climbing grade (slow), the rest
 * ~flat, both at the same race power.
 */
export function predictBikeTimeOnCourse(
  ftpWatts: number,
  riderMassKg: number,
  distanceMeters: number,
  elevationGainMeters: number,
  intensityFactor: number,
  profile: BikeCourseProfile = DEFAULT_BIKE_COURSE,
  avgClimbGrade: number = DEFAULT_AVG_CLIMB_GRADE,
): number {
  if (ftpWatts <= 0 || distanceMeters <= 0) return 0;
  const raceWatts = ftpWatts * intensityFactor;
  const climbDist = Math.min(distanceMeters, Math.max(0, elevationGainMeters) / avgClimbGrade);
  const flatDist = distanceMeters - climbDist;
  const vFlat = bikeSpeedForPower(raceWatts, riderMassKg, { ...profile, gradeFraction: 0 });
  const vClimb = bikeSpeedForPower(raceWatts, riderMassKg, { ...profile, gradeFraction: avgClimbGrade });
  const t = (vFlat > 0 ? flatDist / vFlat : 0) + (vClimb > 0 ? climbDist / vClimb : 0);
  return Math.round(t);
}

/** Invert the course model: the FTP required to finish in `targetSeconds`. */
export function requiredFtpForBikeTime(
  targetSeconds: number,
  riderMassKg: number,
  distanceMeters: number,
  elevationGainMeters: number,
  intensityFactor: number,
  profile: BikeCourseProfile = DEFAULT_BIKE_COURSE,
  avgClimbGrade: number = DEFAULT_AVG_CLIMB_GRADE,
): number {
  if (targetSeconds <= 0 || distanceMeters <= 0) return 0;
  let lo = 40; // watts
  let hi = 700;
  // More FTP → less time (monotonic), so search for the FTP that hits the target.
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    const t = predictBikeTimeOnCourse(mid, riderMassKg, distanceMeters, elevationGainMeters, intensityFactor, profile, avgClimbGrade);
    if (t > targetSeconds) lo = mid; // too slow → need more power
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

// ── Run (Daniels equivalent-performance, slowed for the brick) ───────────────

/** Predict run leg seconds off the bike: Daniels equivalent time × brick factor. */
export function predictRunSeconds(vdot: number, meters: number, brickFactor: number): number {
  if (vdot <= 0 || meters <= 0) return 0;
  return Math.round(predictRaceTimeSeconds(vdot, meters) * brickFactor);
}

// ── Reference-time bundle (feeds the decomposition, G2) ──────────────────────

export interface TriAnchors {
  run: number; // VDOT
  bike: number; // FTP watts
  swim: number; // CSS m/s
}

export interface LegReferenceTimes {
  swimSeconds: number;
  bikeSeconds: number;
  runSeconds: number;
  totalSeconds: number;
}

/**
 * Each leg's time at NOMINAL sustainable race intensity for the athlete's
 * current anchors — the "if you raced today at sensible intensities" baseline.
 * The decomposition scales these by a single factor to hit a target finish.
 */
export function legReferenceTimes(
  distance: TriDistance,
  anchors: TriAnchors,
  riderMassKg: number,
  opts?: { intensities?: TriRaceIntensities; course?: BikeCourseProfile },
): LegReferenceTimes {
  const d = TRI_DISTANCE_METERS[distance];
  const I = opts?.intensities ?? DEFAULT_RACE_INTENSITY[distance];
  const swimSeconds = predictSwimSeconds(anchors.swim, d.swimMeters, I.swimCssFraction);
  const bikeSeconds = predictBikeSeconds(anchors.bike, riderMassKg, d.bikeMeters, I.bikeIntensityFactor, opts?.course);
  const runSeconds = predictRunSeconds(anchors.run, d.runMeters, I.runBrickFactor);
  return { swimSeconds, bikeSeconds, runSeconds, totalSeconds: swimSeconds + bikeSeconds + runSeconds };
}

export const DISCIPLINE_ORDER: readonly Discipline[] = ['swim', 'bike', 'run'];

// ════════════════════════════════════════════════════════════════════════════
// Story G2 — goal-time DECOMPOSITION (spec §1.2–§1.5, §2)
// Target finish → subtract transitions → split the moving budget across legs by
// the athlete's own strengths → per-leg race targets + the anchor each demands.
// ════════════════════════════════════════════════════════════════════════════

/** T1 (swim→bike) + T2 (bike→run) defaults per distance. Tunable per cohort/race. */
export interface Transitions {
  t1Seconds: number;
  t2Seconds: number;
}
export const DEFAULT_TRANSITIONS: Readonly<Record<TriDistance, Transitions>> = {
  sprint: { t1Seconds: 90, t2Seconds: 60 },
  olympic: { t1Seconds: 150, t2Seconds: 75 },
  '70.3': { t1Seconds: 210, t2Seconds: 90 },
  ironman: { t1Seconds: 300, t2Seconds: 150 },
};

/**
 * Fallback time-share of the MOVING budget when anchors are missing/provisional
 * (cold start). Published mid-pack distributions — NOT the allocator's
 * RACE_DEMAND_WEIGHT (that's a training-demand weight, not a time share).
 */
export const TRI_TIME_SHARE: Readonly<Record<TriDistance, Record<Discipline, number>>> = {
  sprint: { swim: 0.14, bike: 0.54, run: 0.32 },
  olympic: { swim: 0.12, bike: 0.53, run: 0.35 },
  '70.3': { swim: 0.1, bike: 0.52, run: 0.38 },
  ironman: { swim: 0.1, bike: 0.55, run: 0.35 },
};

export interface LegTarget {
  discipline: Discipline;
  targetSeconds: number; // this leg's slice of the moving budget
  raceIntensity: number; // the %anchor (or IF) this leg is raced at
  // The pace/power the target implies, in the leg's native display unit:
  targetPaceSecPer100?: number; // swim (sec / 100 m)
  targetWatts?: number; // bike
  targetIF?: number; // bike (targetWatts / current FTP)
  targetPaceSecPerKm?: number; // run (on-course, i.e. brick-slowed)
  /** The anchor (CSS m/s · FTP W · VDOT) this target demands at the nominal race intensity. */
  requiredAnchor: number;
}

export interface GoalTimeInput {
  distance: TriDistance;
  targetFinishSeconds: number;
  anchors: TriAnchors; // 0 / negative in any field ⇒ treat as missing → typical-split fallback
  riderMassKg: number;
  transitions?: Transitions;
  intensities?: TriRaceIntensities;
  course?: BikeCourseProfile;
}

export interface GoalDecomposition {
  distance: TriDistance;
  targetFinishSeconds: number;
  transitionSeconds: number;
  movingBudgetSeconds: number;
  legs: Record<Discipline, LegTarget>;
  strategy: 'strength_relative' | 'typical_split';
  /** movingBudget / referenceTotal. ≥1 ⇒ current fitness already meets the finish. */
  scaleFactor: number;
  notes: string[];
}

const hasAllAnchors = (a: TriAnchors) => a.run > 0 && a.bike > 0 && a.swim > 0;

/** Invert a scaled per-leg target back to the pace/power + required anchor it demands. */
function invertLeg(
  discipline: Discipline,
  meters: number,
  targetSeconds: number,
  I: TriRaceIntensities,
  riderMassKg: number,
  currentFtp: number,
  course: BikeCourseProfile,
): LegTarget {
  const v = meters / targetSeconds; // m/s on course
  if (discipline === 'swim') {
    const requiredAnchor = v / I.swimCssFraction; // CSS m/s the pace sits at race intensity
    return {
      discipline,
      targetSeconds,
      raceIntensity: I.swimCssFraction,
      targetPaceSecPer100: Math.round(100 / v),
      requiredAnchor: Number(requiredAnchor.toFixed(3)),
    };
  }
  if (discipline === 'bike') {
    const targetWatts = Math.round(bikePowerForSpeed(v, riderMassKg, course));
    const requiredFtp = Math.round(targetWatts / I.bikeIntensityFactor);
    return {
      discipline,
      targetSeconds,
      raceIntensity: I.bikeIntensityFactor,
      targetWatts,
      targetIF: currentFtp > 0 ? Number((targetWatts / currentFtp).toFixed(2)) : undefined,
      requiredAnchor: requiredFtp,
    };
  }
  // run: on-course pace includes the brick factor; the flat-equivalent time
  // (targetSeconds / brickFactor) is what the VDOT anchor must support.
  const flatEquivalentSeconds = targetSeconds / I.runBrickFactor;
  const requiredVdot = vdotFromRace({ distanceMeters: meters, timeSeconds: flatEquivalentSeconds });
  return {
    discipline,
    targetSeconds,
    raceIntensity: I.runBrickFactor,
    targetPaceSecPerKm: Math.round(targetSeconds / (meters / 1000)),
    requiredAnchor: Number(requiredVdot.toFixed(1)),
  };
}

/**
 * Decompose a target finish time into per-leg race targets + the anchor each
 * leg demands. Strength-relative by default (predict each leg from the athlete's
 * own anchors, scale all three by one factor to hit the moving budget);
 * typical-split fallback when any anchor is missing.
 */
export function decomposeGoalTime(input: GoalTimeInput): GoalDecomposition {
  const d = TRI_DISTANCE_METERS[input.distance];
  const I = input.intensities ?? DEFAULT_RACE_INTENSITY[input.distance];
  const course = input.course ?? DEFAULT_BIKE_COURSE;
  const tr = input.transitions ?? DEFAULT_TRANSITIONS[input.distance];
  const transitionSeconds = tr.t1Seconds + tr.t2Seconds;
  const movingBudgetSeconds = Math.max(1, input.targetFinishSeconds - transitionSeconds);
  const notes: string[] = [];

  const legMeters: Record<Discipline, number> = {
    swim: d.swimMeters,
    bike: d.bikeMeters,
    run: d.runMeters,
  };

  let targetsSec: Record<Discipline, number>;
  let strategy: GoalDecomposition['strategy'];

  if (hasAllAnchors(input.anchors)) {
    strategy = 'strength_relative';
    const ref = legReferenceTimes(input.distance, input.anchors, input.riderMassKg, { intensities: I, course });
    const k = movingBudgetSeconds / ref.totalSeconds;
    targetsSec = {
      swim: ref.swimSeconds * k,
      bike: ref.bikeSeconds * k,
      run: ref.runSeconds * k,
    };
    notes.push(
      k >= 1
        ? `At sensible race intensities your current fitness already meets this finish (scale ${k.toFixed(2)}× ≥ 1) — the plan is sharpening + durability, not big fitness gains.`
        : `You'd need to be ${((1 / k - 1) * 100).toFixed(0)}% faster than your current sustainable pace across the board (scale ${k.toFixed(2)}×) — see the per-leg required anchors for where the gap is.`,
    );
  } else {
    strategy = 'typical_split';
    const share = TRI_TIME_SHARE[input.distance];
    targetsSec = {
      swim: movingBudgetSeconds * share.swim,
      bike: movingBudgetSeconds * share.bike,
      run: movingBudgetSeconds * share.run,
    };
    notes.push('Missing one or more anchors (VDOT/FTP/CSS) — used the published mid-pack time split. Add your anchors for a strength-relative target.');
  }

  const legs = {
    swim: invertLeg('swim', legMeters.swim, targetsSec.swim, I, input.riderMassKg, input.anchors.bike, course),
    bike: invertLeg('bike', legMeters.bike, targetsSec.bike, I, input.riderMassKg, input.anchors.bike, course),
    run: invertLeg('run', legMeters.run, targetsSec.run, I, input.riderMassKg, input.anchors.bike, course),
  } as Record<Discipline, LegTarget>;

  const scaleFactor =
    strategy === 'strength_relative'
      ? movingBudgetSeconds /
        legReferenceTimes(input.distance, input.anchors, input.riderMassKg, { intensities: I, course }).totalSeconds
      : 1;

  return {
    distance: input.distance,
    targetFinishSeconds: input.targetFinishSeconds,
    transitionSeconds,
    movingBudgetSeconds,
    legs,
    strategy,
    scaleFactor: Number(scaleFactor.toFixed(3)),
    notes,
  };
}
