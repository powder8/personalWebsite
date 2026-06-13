/**
 * Grade Adjusted Pace (GAP) — what a run's pace would have been on flat ground
 * for the same effort. Hills make raw pace lie: a 7:00/mi up a steep grade is a
 * much harder effort than 7:00/mi on the flat, and a downhill 7:00 is easier.
 * For judging EFFORT and FITNESS we want the flat-equivalent.
 *
 * Model: Minetti et al. (2002) metabolic cost of running as a function of
 * gradient (J·kg⁻¹·m⁻¹). The cost ratio cost(grade)/cost(0) is the speed
 * multiplier (same metabolic rate → you'd run this many× the speed on flat),
 * so flat-equivalent time = actual time ÷ that ratio. Pure + DB-free.
 */

const FLAT_COST = 3.6; // C(0), J/kg/m

/** Minetti running energy cost at a gradient i = rise/run (fraction). */
export function runningCostOfGrade(grade: number): number {
  // The polynomial is fit over roughly ±45% grade; clamp beyond that.
  const i = Math.max(-0.45, Math.min(0.45, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Speed multiplier vs flat for a gradient: >1 uphill (you'd be faster on flat), <1 downhill. */
export function gradeAdjustFactor(grade: number): number {
  return runningCostOfGrade(grade) / FLAT_COST;
}

export interface GapSplit {
  distanceMeters: number;
  durationSeconds?: number | null;
  paceSecPerKm?: number | null;
  elevDiffMeters?: number | null;
}

export interface GapResult {
  gapSecPerKm: number; // grade-adjusted average pace
  rawSecPerKm: number; // distance-weighted raw pace over the same splits
  totalDistanceMeters: number;
  climbMeters: number; // total ascent across the splits
  /** GAP is meaningfully faster/slower than raw (terrain actually mattered). */
  significant: boolean;
}

const MIN_SPLIT_M = 200; // ignore tiny trailing fragments
const SIGNIFICANT_SEC_PER_KM = 6; // ~10 s/mi difference counts as "mattered"

/**
 * Grade-adjusted pace from per-split distance + elevation. Returns null when
 * there isn't enough timed, located split data to compute it honestly.
 */
export function gapFromSplits(splits: GapSplit[] | null | undefined): GapResult | null {
  if (!splits?.length) return null;
  let dist = 0;
  let rawTime = 0;
  let gapTime = 0;
  let climb = 0;
  for (const s of splits) {
    const d = s.distanceMeters ?? 0;
    if (d < MIN_SPLIT_M) continue;
    const t = s.durationSeconds && s.durationSeconds > 0 ? s.durationSeconds : s.paceSecPerKm && s.paceSecPerKm > 0 ? (d / 1000) * s.paceSecPerKm : 0;
    if (t <= 0) continue;
    const grade = s.elevDiffMeters != null && d > 0 ? s.elevDiffMeters / d : 0;
    const factor = gradeAdjustFactor(grade);
    dist += d;
    rawTime += t;
    gapTime += t / factor; // flat-equivalent time for this split
    if (s.elevDiffMeters && s.elevDiffMeters > 0) climb += s.elevDiffMeters;
  }
  if (dist < MIN_SPLIT_M) return null;
  const km = dist / 1000;
  const gapSecPerKm = gapTime / km;
  const rawSecPerKm = rawTime / km;
  return {
    gapSecPerKm,
    rawSecPerKm,
    totalDistanceMeters: dist,
    climbMeters: climb,
    significant: Math.abs(rawSecPerKm - gapSecPerKm) >= SIGNIFICANT_SEC_PER_KM,
  };
}

/** Grade-adjusted total time for an effort, for VDOT/fitness from a hilly run. */
export function gapAdjustedSeconds(splits: GapSplit[] | null | undefined, fallbackSeconds: number): number {
  const g = gapFromSplits(splits);
  if (!g) return fallbackSeconds;
  return Math.round(g.gapSecPerKm * (g.totalDistanceMeters / 1000));
}
