/**
 * ATTAINABILITY ceiling (spec: the "is it possible?" axis, distinct from the
 * "will you get there?" trajectory axis in triFeasibilityLogic).
 *
 * The feasibility engine on its own only asks whether an athlete closes the gap
 * from current fitness at their gain RATE in the weeks they have. That conflates
 * HARD with IMPOSSIBLE: it can imply that more weeks would reach a time that, for
 * a 52-year-old with a demanding job and a young family, isn't reachable under
 * any circumstances. This module supplies the missing ceiling: the best anchor
 * (VDOT / FTP watts / CSS m/s) an athlete could realistically reach BY RACE DAY,
 * ignoring life constraints — the honest upper bound on what's possible.
 *
 * Composite model (per the design decision):
 *  1. AGE-GRADE DECLINE is the shape + the outer BOUNDING BOX — a near-elite
 *     performance for the age that nobody but a genuine elite exceeds.
 *  2. CURRENT fitness + recency-discounted PERSONAL BESTS set the athlete's
 *     proven ability level (an old PB under different life conditions counts
 *     only partly).
 *  3. AGE-DAMPED HEADROOM is the modest room to improve on that proven level.
 *  Ceiling = min( provenLevel × (1 + headroom), age-graded bounding box ).
 *
 * Every constant is a DEFENSIBLE STARTING VALUE flagged tunable — masters
 * decline rates, elite references, and headroom all recalibrate with cohort
 * data. Sources: WMA/USAT age-grading (decline shape), masters VO2max/FTP
 * decline literature (~0.5–1%/yr), swim-holds-best coaching consensus.
 */
import type { Discipline } from './types';

/** Age at which each anchor peaks (before decline). Power peaks a touch later. */
const PEAK_AGE: Record<Discipline, number> = { run: 28, bike: 30, swim: 26 };

/** Fractional decline per year past peak, ages ~peak–60. Power fades fastest,
 * swim slowest (technique-driven). Accelerates after 60 (see ageDeclineFactor). */
const DECLINE_PER_YEAR: Record<Discipline, number> = { run: 0.007, bike: 0.008, swim: 0.0045 };

/** Best-case headroom over the proven level at PEAK age (before age damping). */
const BASE_HEADROOM: Record<Discipline, number> = { run: 0.12, bike: 0.14, swim: 0.16 };

/**
 * Near-elite reference anchor at peak age — the outer bounding box. Bike is
 * per-kg (multiplied by body mass); run VDOT and swim CSS are absolute. These
 * are strong-amateur/elite ceilings, not world records.
 */
const ELITE_AT_PEAK = {
  runVdot: 80, // ~sub-elite amateur VDOT
  bikeWattsPerKg: 5.8, // strong elite amateur FTP/kg
  swimCssMetersPerSec: 1.9, // ~1:29/100m CSS
};

/** Multiplicative age factor vs. peak (1.0 at/below peak), steepening after 60. */
export function ageDeclineFactor(discipline: Discipline, ageYears: number): number {
  const peak = PEAK_AGE[discipline];
  if (ageYears <= peak) return 1;
  const rate = DECLINE_PER_YEAR[discipline];
  const preSixty = Math.min(ageYears, 60) - peak;
  const postSixty = Math.max(0, ageYears - 60);
  const factor = 1 - rate * preSixty - rate * 1.6 * postSixty; // 60% steeper past 60
  return Math.max(0.35, factor);
}

/** Headroom fraction: base, damped by age (older → less room). */
export function headroomFraction(discipline: Discipline, ageYears: number): number {
  const ageDamp = Math.max(0.35, Math.min(1, 1 - (ageYears - 30) * 0.012));
  return BASE_HEADROOM[discipline] * ageDamp;
}

/** How much an old PB still counts: full when recent, floors at 0.15 for a PB
 * set a dozen-plus years / a life-stage ago. */
export function pbRecencyWeight(yearsSincePB: number): number {
  return Math.max(0.15, Math.min(1, 1 - yearsSincePB / 12));
}

export interface AttainabilityInput {
  discipline: Discipline;
  currentAnchor: number;
  ageYears: number; // age at race day
  /** Body mass (kg) — required for the bike bounding box (W/kg → W). */
  massKg?: number;
  /** A personal best for this anchor and the age it was set at. */
  personalBest?: { anchor: number; ageAtPB: number };
}

export interface Attainability {
  /** Best anchor realistically reachable by race day, ignoring life constraints. */
  ceiling: number;
  /** The age-graded near-elite cap (the outer bounding box). */
  boundingBox: number;
  /** The athlete's proven ability level (current, raised by a discounted PB). */
  provenLevel: number;
  headroomFraction: number;
  /** What set the ceiling: personal headroom, or the age-graded elite cap. */
  limitedBy: 'headroom' | 'age_bounding_box';
}

export function assessAttainability(input: AttainabilityInput): Attainability {
  const { discipline, currentAnchor, ageYears } = input;

  // Proven level: current, raised toward a recency-discounted PB (projected to
  // race-day age via the decline shape). An old PB barely moves it.
  let provenLevel = currentAnchor;
  if (input.personalBest && input.personalBest.anchor > 0) {
    const pbProjectedToNow =
      (input.personalBest.anchor * ageDeclineFactor(discipline, ageYears)) /
      ageDeclineFactor(discipline, input.personalBest.ageAtPB);
    const w = pbRecencyWeight(Math.max(0, ageYears - input.personalBest.ageAtPB));
    provenLevel = Math.max(currentAnchor, currentAnchor + (pbProjectedToNow - currentAnchor) * w);
  }

  const headroom = headroomFraction(discipline, ageYears);
  const personalCeiling = provenLevel * (1 + headroom);

  // Age-graded bounding box (near-elite for the age).
  const factor = ageDeclineFactor(discipline, ageYears);
  let boundingBox: number;
  if (discipline === 'bike') {
    boundingBox = ELITE_AT_PEAK.bikeWattsPerKg * (input.massKg ?? 75) * factor;
  } else if (discipline === 'swim') {
    boundingBox = ELITE_AT_PEAK.swimCssMetersPerSec * factor;
  } else {
    boundingBox = ELITE_AT_PEAK.runVdot * factor;
  }

  const ceiling = Math.min(personalCeiling, boundingBox);
  return {
    ceiling,
    boundingBox,
    provenLevel,
    headroomFraction: headroom,
    limitedBy: personalCeiling <= boundingBox ? 'headroom' : 'age_bounding_box',
  };
}
