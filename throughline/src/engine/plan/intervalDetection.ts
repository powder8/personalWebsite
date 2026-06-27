/**
 * Detect interval workouts from watch laps. When an athlete presses the lap
 * button for each rep, the resulting laps form a bimodal pace distribution:
 * fast (effort) and slow (recovery). This extractor finds that split and
 * returns per-rep metrics so the debrief can speak to the session accurately.
 *
 * Works even when the athlete missed a few laps — requires ≥ 3 effort laps.
 */

export interface LapSeg {
  distanceMeters: number;
  durationSeconds: number;
  avgHr?: number | null;
}

export interface IntervalResult {
  repCount: number;
  /** Distance-weighted average pace for effort laps (sec/km). */
  repAvgPaceSecPerKm: number;
  /** Average distance per rep (meters). */
  repAvgDistMeters: number;
  /** Total distance covered in effort laps (meters). */
  repTotalMeters: number;
  /** Average recovery pace (sec/km), null if no identifiable recovery laps. */
  recoveryAvgPaceSecPerKm: number | null;
}

/**
 * Returns interval metrics if the laps suggest a track/rep session, else null.
 *
 * Algorithm:
 *   1. Filter out GPS artifacts (< 50 m or < 5 s).
 *   2. Compute sec/km for each lap.
 *   3. Find median pace; effort threshold = 82% of median.
 *      (For a 200m rep session this cleanly separates ~5:45 effort from ~13:00 rest.)
 *   4. Require ≥ 3 effort laps, avg rep ≤ 1,600 m and pace ≤ 420 s/km (≈ 6:44/mi).
 *      (Prevents mislabelling a 3 × mile tempo as "intervals".)
 */
export function detectIntervals(laps: LapSeg[] | null | undefined): IntervalResult | null {
  if (!laps?.length) return null;

  const valid = laps.filter((l) => l.distanceMeters > 50 && l.durationSeconds > 5);
  if (valid.length < 4) return null;

  const withPace = valid.map((l) => ({
    ...l,
    paceSecPerKm: l.durationSeconds / (l.distanceMeters / 1000),
  }));

  const sortedByPace = [...withPace].sort((a, b) => a.paceSecPerKm - b.paceSecPerKm);
  const medianPace = sortedByPace[Math.floor(sortedByPace.length / 2)].paceSecPerKm;

  // Effort laps are meaningfully faster than the median
  const effortThreshold = medianPace * 0.82;
  const effortLaps = withPace.filter((l) => l.paceSecPerKm <= effortThreshold);
  const recoveryLaps = withPace.filter((l) => l.paceSecPerKm > effortThreshold);

  if (effortLaps.length < 3) return null;

  const effortTotalMeters = effortLaps.reduce((s, l) => s + l.distanceMeters, 0);
  const repAvgPaceSecPerKm =
    effortLaps.reduce((s, l) => s + l.paceSecPerKm * l.distanceMeters, 0) / effortTotalMeters;
  const repAvgDistMeters = effortTotalMeters / effortLaps.length;

  // Sanity: reps should be short and fast — not a continuous tempo or mile repeats
  if (repAvgDistMeters > 1600 || repAvgPaceSecPerKm > 420) return null;

  const recoveryTotalMeters = recoveryLaps.reduce((s, l) => s + l.distanceMeters, 0);
  const recoveryAvgPaceSecPerKm =
    recoveryLaps.length > 0 && recoveryTotalMeters > 0
      ? recoveryLaps.reduce((s, l) => s + l.paceSecPerKm * l.distanceMeters, 0) / recoveryTotalMeters
      : null;

  return {
    repCount: effortLaps.length,
    repAvgPaceSecPerKm,
    repAvgDistMeters,
    repTotalMeters: effortTotalMeters,
    recoveryAvgPaceSecPerKm,
  };
}
