/**
 * Pure, unit-testable health/wellness logic for the general Health page.
 *
 * NO `server-only`, NO DB, NO schema dependencies — just numbers in, numbers out.
 * Everything here is derived from data that already exists (VDOT, wearable
 * signals, sex + age) so the Health page needs no migration.
 *
 * ─── Normative data & citations ────────────────────────────────────────────
 * The VO2max percentile tables below are the FRIEND registry treadmill
 * standards (Fitness Registry and the Importance of Exercise National
 * Database), the reference the ACSM adopted for cardiorespiratory fitness
 * norms:
 *   Kaminsky LA, Arena R, Myers J. "Reference Standards for Cardiorespiratory
 *   Fitness Measured With Cardiopulmonary Exercise Testing: Data From the
 *   Fitness Registry and the Importance of Exercise National Database."
 *   Mayo Clin Proc. 2015;90(11):1515-1523. doi:10.1016/j.mayocp.2015.07.026
 * Values are maximal VO2 (mL·kg⁻¹·min⁻¹) from maximal treadmill CPET, by sex
 * and age decade, at the 10th/25th/50th/75th/90th percentiles.
 *
 * Fitness-category labels (Very Poor … Superior) follow the ACSM percentile
 * banding used with these tables (ACSM's Guidelines for Exercise Testing and
 * Prescription, 10th ed.).
 *
 * VDOT→VO2max: VDOT (Jack Daniels & Jimmy Gilbert, "Oxygen Power"; Daniels'
 * Running Formula, 3rd ed., 2014) is a performance-derived VO2max proxy on the
 * same mL·kg⁻¹·min⁻¹ scale — it folds running economy into raw aerobic
 * capacity, so for a trained runner VDOT ≈ VO2max. We surface VDOT directly as
 * an ESTIMATED VO2max (not lab-measured) — see `vo2maxFromVdot`.
 *
 * Resting-HR context uses population reference ranges (American Heart
 * Association: normal resting HR 60–100 bpm; well-trained endurance athletes
 * commonly 40–60). Sleep guidelines follow the National Sleep Foundation /
 * CDC adult recommendation of 7–9 h. BMI bands follow the WHO classification.
 * Each is cited at its function below. Where a signal is compared only to the
 * athlete's own rolling baseline (HRV especially — cross-device overnight HRV
 * lacks a clean population norm), that is stated explicitly.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Sex = 'male' | 'female';

/** One age-decade row of the FRIEND treadmill percentile standard. */
interface Vo2Anchor {
  ageMid: number; // midpoint of the decade (25 = 20-29, …)
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

// FRIEND registry, maximal treadmill CPET, VO2max in mL·kg⁻¹·min⁻¹.
// Source: Kaminsky et al., Mayo Clin Proc 2015;90(11):1515-1523 (Table 3).
const FRIEND_TREADMILL: Record<Sex, Vo2Anchor[]> = {
  male: [
    { ageMid: 25, p10: 32.1, p25: 40.1, p50: 48.0, p75: 55.2, p90: 61.8 },
    { ageMid: 35, p10: 30.2, p25: 35.9, p50: 42.4, p75: 49.2, p90: 56.5 },
    { ageMid: 45, p10: 26.8, p25: 31.9, p50: 37.8, p75: 45.0, p90: 52.1 },
    { ageMid: 55, p10: 22.8, p25: 27.1, p50: 32.6, p75: 39.7, p90: 45.6 },
    { ageMid: 65, p10: 19.8, p25: 23.7, p50: 28.2, p75: 34.5, p90: 40.3 },
    { ageMid: 75, p10: 17.1, p25: 20.4, p50: 24.4, p75: 30.4, p90: 36.6 },
  ],
  female: [
    { ageMid: 25, p10: 23.9, p25: 30.5, p50: 37.6, p75: 44.7, p90: 51.3 },
    { ageMid: 35, p10: 20.9, p25: 25.3, p50: 30.2, p75: 36.1, p90: 41.4 },
    { ageMid: 45, p10: 18.8, p25: 22.1, p50: 26.7, p75: 32.4, p90: 38.4 },
    { ageMid: 55, p10: 17.3, p25: 19.9, p50: 23.4, p75: 27.6, p90: 32.0 },
    { ageMid: 65, p10: 14.6, p25: 17.2, p50: 20.0, p75: 23.8, p90: 27.0 },
    { ageMid: 75, p10: 13.6, p25: 15.6, p50: 18.3, p75: 20.8, p90: 23.1 },
  ],
};

/** The percentile levels that each anchor column represents. */
const ANCHOR_PCTS = [10, 25, 50, 75, 90] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a free-text `athletes.sex` to the norm-table keys, else null. */
export function normalizeSex(sex: string | null | undefined): Sex | null {
  if (sex === 'male' || sex === 'female') return sex;
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Linear interpolation of y at x between two points; used for age blending. */
function lerp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/**
 * The FRIEND anchors for a sex at an exact age, linearly interpolated between
 * adjacent decade midpoints (and clamped to the first/last decade outside the
 * 20–79 table range). Returns the five [value, percentile] anchor points.
 */
function anchorsAtAge(sex: Sex, age: number): number[] {
  const rows = FRIEND_TREADMILL[sex];
  const first = rows[0];
  const last = rows[rows.length - 1];

  let cols: number[];
  if (age <= first.ageMid) {
    cols = [first.p10, first.p25, first.p50, first.p75, first.p90];
  } else if (age >= last.ageMid) {
    cols = [last.p10, last.p25, last.p50, last.p75, last.p90];
  } else {
    // Find the bracketing decades and blend each percentile column by age.
    let lo = rows[0];
    let hi = rows[1];
    for (let i = 0; i < rows.length - 1; i++) {
      if (age >= rows[i].ageMid && age <= rows[i + 1].ageMid) {
        lo = rows[i];
        hi = rows[i + 1];
        break;
      }
    }
    cols = [
      lerp(age, lo.ageMid, lo.p10, hi.ageMid, hi.p10),
      lerp(age, lo.ageMid, lo.p25, hi.ageMid, hi.p25),
      lerp(age, lo.ageMid, lo.p50, hi.ageMid, hi.p50),
      lerp(age, lo.ageMid, lo.p75, hi.ageMid, hi.p75),
      lerp(age, lo.ageMid, lo.p90, hi.ageMid, hi.p90),
    ];
  }
  return cols;
}

// ---------------------------------------------------------------------------
// VDOT → VO2max
// ---------------------------------------------------------------------------

/**
 * Estimated VO2max (mL·kg⁻¹·min⁻¹) from a runner's VDOT. VDOT is Daniels'
 * performance-derived VO2max proxy on the same scale, so we treat it as an
 * estimate 1:1 (rounded to 0.1). Returns null for a missing/invalid VDOT.
 * NOTE: this is an ESTIMATE from race/threshold performance, not a lab or
 * device-measured VO2max.
 */
export function vo2maxFromVdot(vdot: number | null | undefined): number | null {
  if (vdot == null || !Number.isFinite(vdot) || vdot <= 0) return null;
  return Math.round(vdot * 10) / 10;
}

// ---------------------------------------------------------------------------
// Percentile & fitness age
// ---------------------------------------------------------------------------

/**
 * Age/sex percentile (1–99) for a VO2max value against the FRIEND treadmill
 * standard. Piecewise-linear across the five anchor percentiles, extrapolated
 * with the nearest segment's slope at the tails and clamped to [1, 99].
 * Returns null when sex or age is unknown (norms are sex- and age-specific).
 */
export function percentileForVo2max(
  vo2max: number | null | undefined,
  sex: Sex | null | undefined,
  age: number | null | undefined,
): number | null {
  if (vo2max == null || !Number.isFinite(vo2max)) return null;
  if (!sex || age == null || !Number.isFinite(age)) return null;

  const cols = anchorsAtAge(sex, age); // ascending VO2max values
  const v = vo2max;

  // Below the lowest anchor: extrapolate with the first segment's slope.
  if (v <= cols[0]) {
    const slope = (ANCHOR_PCTS[1] - ANCHOR_PCTS[0]) / (cols[1] - cols[0]);
    return Math.round(clamp(ANCHOR_PCTS[0] - (cols[0] - v) * slope, 1, 99));
  }
  // Above the highest anchor: extrapolate with the last segment's slope.
  const n = cols.length - 1;
  if (v >= cols[n]) {
    const slope = (ANCHOR_PCTS[n] - ANCHOR_PCTS[n - 1]) / (cols[n] - cols[n - 1]);
    return Math.round(clamp(ANCHOR_PCTS[n] + (v - cols[n]) * slope, 1, 99));
  }
  // Interior: find the bracketing anchor pair and interpolate.
  for (let i = 0; i < n; i++) {
    if (v >= cols[i] && v <= cols[i + 1]) {
      const pct = lerp(v, cols[i], ANCHOR_PCTS[i], cols[i + 1], ANCHOR_PCTS[i + 1]);
      return Math.round(clamp(pct, 1, 99));
    }
  }
  return null; // unreachable
}

/**
 * "Fitness age": the age at which the athlete's VO2max equals the population
 * median (P50) for their sex — a younger fitness age than chronological age
 * means above-average cardio fitness for their years. Interpolates the P50-by-
 * age curve and clamps to the table's 20–80 range. Null if sex unknown.
 *
 * Concept per Nes BM et al., "Estimating V·O2peak from a nonexercise
 * prediction model: the HUNT Study" (Med Sci Sports Exerc. 2011) and the
 * widely used "fitness age" framing built on VO2max age norms.
 */
export function fitnessAgeForVo2max(
  vo2max: number | null | undefined,
  sex: Sex | null | undefined,
): number | null {
  if (vo2max == null || !Number.isFinite(vo2max) || !sex) return null;
  const rows = FRIEND_TREADMILL[sex];
  const v = vo2max;

  // P50 decreases as age increases. Fitter than the youngest decade → floor 20.
  if (v >= rows[0].p50) return 20;
  const last = rows[rows.length - 1];
  if (v <= last.p50) return 80; // less fit than the oldest decade → ceiling 80

  for (let i = 0; i < rows.length - 1; i++) {
    const hi = rows[i]; // younger, higher P50
    const lo = rows[i + 1]; // older, lower P50
    if (v <= hi.p50 && v >= lo.p50) {
      // Interpolate age against P50 (note: P50 is the x here, age the y).
      const age = lerp(v, hi.p50, hi.ageMid, lo.p50, lo.ageMid);
      return Math.round(clamp(age, 20, 80));
    }
  }
  return null; // unreachable
}

export type FitnessCategory =
  | 'Very Poor'
  | 'Poor'
  | 'Fair'
  | 'Good'
  | 'Excellent'
  | 'Superior';

/**
 * ACSM fitness-category band for a cardiorespiratory-fitness percentile.
 * Source: ACSM's Guidelines for Exercise Testing and Prescription, 10th ed.,
 * percentile banding used with the FRIEND standards.
 */
export function categoryForPercentile(pct: number | null | undefined): FitnessCategory | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 90) return 'Superior';
  if (pct >= 70) return 'Excellent';
  if (pct >= 50) return 'Good';
  if (pct >= 30) return 'Fair';
  if (pct >= 10) return 'Poor';
  return 'Very Poor';
}

/** English ordinal for a percentile: 1→"1st", 42→"42nd", 93→"93rd". */
export function ordinal(n: number): string {
  const abs = Math.abs(Math.round(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  let suffix = 'th';
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = 'st';
    else if (mod10 === 2) suffix = 'nd';
    else if (mod10 === 3) suffix = 'rd';
  }
  return `${Math.round(n)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Resting HR — population context (age-group norm complement to the baseline z)
// ---------------------------------------------------------------------------

export type RestingHrBand = 'athlete' | 'excellent' | 'good' | 'average' | 'elevated';

export interface RestingHrContext {
  band: RestingHrBand;
  label: string;
}

/**
 * Population context for a resting heart rate. The athlete's own rolling
 * baseline (z-score) is the primary read for day-to-day change; this adds the
 * "vs the wider population" frame the general Health page wants.
 *
 * Source: American Heart Association — normal resting HR 60–100 bpm; well-
 * conditioned endurance athletes commonly 40–60 bpm. Bands below are a
 * pragmatic split of that guidance (not finely age-adjusted; per-age RHR norms
 * are a follow-up). Lower is generally better in healthy adults.
 */
export function restingHrContext(rhr: number | null | undefined): RestingHrContext | null {
  if (rhr == null || !Number.isFinite(rhr) || rhr <= 0) return null;
  if (rhr < 50) return { band: 'athlete', label: 'Athlete range' };
  if (rhr < 60) return { band: 'excellent', label: 'Excellent' };
  if (rhr < 70) return { band: 'good', label: 'Good' };
  if (rhr <= 100) return { band: 'average', label: 'Average' };
  return { band: 'elevated', label: 'Above typical range' };
}

// ---------------------------------------------------------------------------
// Sleep — vs adult guideline
// ---------------------------------------------------------------------------

export type SleepStatus = 'good' | 'watch' | 'low';

export interface SleepAssessment {
  status: SleepStatus;
  label: string;
  /** Consistency: 'steady' | 'variable' | null (needs ≥ 3 nights). */
  consistency: 'steady' | 'variable' | null;
}

/**
 * Compare average nightly sleep (hours) and its night-to-night variability to
 * the adult guideline. Source: National Sleep Foundation (Hirshkowitz et al.,
 * Sleep Health 2015) and CDC — adults 18–60 should get ≥ 7 h; 7–9 h is the
 * recommended band. A standard deviation > ~1 h flags an inconsistent schedule
 * (regularity itself is linked to better health outcomes).
 */
export function sleepAssessment(
  avgHours: number | null | undefined,
  stdHours: number | null | undefined,
): SleepAssessment | null {
  if (avgHours == null || !Number.isFinite(avgHours) || avgHours <= 0) return null;

  let status: SleepStatus;
  let label: string;
  if (avgHours >= 7 && avgHours <= 9) {
    status = 'good';
    label = 'Meets the 7–9 h guideline';
  } else if (avgHours >= 6 || avgHours > 9) {
    status = 'watch';
    label = avgHours > 9 ? 'Above the typical range' : 'Slightly under 7 h';
  } else {
    status = 'low';
    label = 'Below the recommended 7 h';
  }

  let consistency: 'steady' | 'variable' | null = null;
  if (stdHours != null && Number.isFinite(stdHours)) {
    consistency = stdHours > 1 ? 'variable' : 'steady';
  }
  return { status, label, consistency };
}

/** Mean and sample standard deviation of a list (ignores non-finite). */
export function meanStd(values: number[]): { mean: number | null; std: number | null; n: number } {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return { mean: null, std: null, n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, std: null, n };
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, std: Math.sqrt(variance), n };
}

// ---------------------------------------------------------------------------
// Body composition — BMI (UI persistence deferred; logic is here + tested)
// ---------------------------------------------------------------------------

export type BmiCategory = 'Underweight' | 'Healthy' | 'Overweight' | 'Obese';

/** BMI from weight (kg) and height (cm), rounded to 0.1. Null on bad input. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (weightKg == null || heightCm == null) return null;
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm)) return null;
  if (weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/**
 * WHO BMI classification. Source: World Health Organization — Underweight
 * < 18.5, Healthy 18.5–24.9, Overweight 25–29.9, Obese ≥ 30. (BMI is a
 * population screen; it does not distinguish muscle from fat, so it reads high
 * for many trained athletes — surfaced with that caveat in the UI.)
 */
export function bmiCategory(value: number | null | undefined): BmiCategory | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (value < 18.5) return 'Underweight';
  if (value < 25) return 'Healthy';
  if (value < 30) return 'Overweight';
  return 'Obese';
}
