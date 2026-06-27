/**
 * Detect interval workouts from watch laps. When an athlete presses the lap
 * button for each rep, the resulting laps form a bimodal pace distribution:
 * fast (effort) and slow (recovery). This extractor finds that split and
 * returns per-rep metrics so the debrief can speak to the session accurately.
 *
 * Works even when the athlete missed a few laps — requires ≥ 3 effort laps.
 *
 * The recovery TYPE (walk / jog / float) is as important as the rep pace:
 * it determines whether the session trained neuromuscular power, VO2max, or
 * lactate threshold capacity. The work:rest ratio and pace fade across the set
 * are the other two signals a coach would look at immediately.
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

  /**
   * Ratio of total effort time to total recovery time (e.g. 0.45 = "1:2.2").
   * Lower = more rest relative to work. Near-complete recovery is ~0.25–0.35
   * (1:3–1:4); threshold-style work is closer to 1:1.
   */
  workRestRatioTime: number | null;

  /**
   * Character of the recovery based on avg recovery pace:
   *   'walk'  > 600 sec/km (> ~16 min/mi) — walking, near-complete rest
   *   'jog'   420–600 sec/km (~11–16 min/mi) — jogging, moderate rest
   *   'float' < 420 sec/km (< ~11 min/mi) — float, short aerobic rest
   */
  recoveryType: 'walk' | 'jog' | 'float' | null;

  /**
   * Percentage pace slowed from first half to last half of effort laps.
   * Positive = fade (slower at the end). Negative = negative split (stronger
   * at the end). Null when too few reps to split meaningfully.
   */
  paceFadePct: number | null;
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

  // Work:rest ratio by time (e.g. 0.4 → "1:2.5 work:rest")
  const totalEffortSeconds = effortLaps.reduce((s, l) => s + l.durationSeconds, 0);
  const totalRecoverySeconds = recoveryLaps.reduce((s, l) => s + l.durationSeconds, 0);
  const workRestRatioTime =
    totalRecoverySeconds > 0
      ? Math.round((totalEffortSeconds / totalRecoverySeconds) * 10) / 10
      : null;

  // Recovery character based on avg recovery pace
  const recoveryType: 'walk' | 'jog' | 'float' | null =
    recoveryAvgPaceSecPerKm == null
      ? null
      : recoveryAvgPaceSecPerKm > 600
        ? 'walk'
        : recoveryAvgPaceSecPerKm > 420
          ? 'jog'
          : 'float';

  // Pace fade: first-half effort laps vs last-half (temporal order preserved)
  const mid = Math.floor(effortLaps.length / 2);
  const firstHalf = effortLaps.slice(0, Math.max(mid, 1));
  const lastHalf = effortLaps.slice(Math.max(mid, 1));
  let paceFadePct: number | null = null;
  if (lastHalf.length > 0) {
    const firstAvg = firstHalf.reduce((s, l) => s + l.paceSecPerKm, 0) / firstHalf.length;
    const lastAvg = lastHalf.reduce((s, l) => s + l.paceSecPerKm, 0) / lastHalf.length;
    paceFadePct = Math.round(((lastAvg - firstAvg) / firstAvg) * 100);
  }

  return {
    repCount: effortLaps.length,
    repAvgPaceSecPerKm,
    repAvgDistMeters,
    repTotalMeters: effortTotalMeters,
    recoveryAvgPaceSecPerKm,
    workRestRatioTime,
    recoveryType,
    paceFadePct,
  };
}
