/**
 * Estimate FTP from ride power data — the honest way. Whole-ride average/
 * normalized power badly underestimates FTP (most rides aren't maximal); the
 * standard is the best 20-minute power × 0.95 (Coggan). This computes the best
 * average power over any window of a time-stamped watts stream (robust to non-1Hz
 * or gappy sampling via the time array), then applies the 0.95 factor.
 *
 * Pure — no network. The server fetches the streams; this does the math.
 */

/** The Coggan factor: FTP ≈ best 20-minute power × 0.95. */
export const FTP_FROM_20MIN_FACTOR = 0.95;

/**
 * Best average watts over any `windowSeconds` span of a stream. `times` are
 * seconds-from-start (monotonic, may be gappy); `watts` are same-length samples.
 * Uses an energy integral + two pointers, so the average is time-weighted and
 * correct even when samples aren't 1 Hz. Returns 0 if no full window exists.
 */
export function bestRollingAvgWatts(times: number[], watts: number[], windowSeconds: number): number {
  const n = Math.min(times.length, watts.length);
  if (n < 2 || windowSeconds <= 0) return 0;

  // Cumulative energy: energy[k] = ∫ watts dt from start to sample k. Each
  // segment [i, i+1] contributes watts[i] * (times[i+1] - times[i]).
  const energy = new Array<number>(n);
  energy[0] = 0;
  for (let k = 1; k < n; k++) {
    const dt = Math.max(0, times[k] - times[k - 1]);
    energy[k] = energy[k - 1] + watts[k - 1] * dt;
  }

  let best = 0;
  let i = 0;
  for (let j = 1; j < n; j++) {
    // Advance i while the window [i, j] is longer than needed, keeping it ≥ window.
    while (i < j && times[j] - times[i + 1] >= windowSeconds) i++;
    const span = times[j] - times[i];
    if (span >= windowSeconds && span > 0) {
      const avg = (energy[j] - energy[i]) / span;
      if (avg > best) best = avg;
    }
  }
  return best;
}

/** FTP from a stream: best 20-min power × 0.95 (0 if the ride is too short). */
export function ftpFromWattsStream(times: number[], watts: number[]): number {
  const best20 = bestRollingAvgWatts(times, watts, 20 * 60);
  return best20 > 0 ? Math.round(best20 * FTP_FROM_20MIN_FACTOR) : 0;
}

export interface RideSummary {
  id: number | string;
  durationSeconds: number;
  weightedAvgWatts: number | null; // Strava NP — for ranking candidates
  deviceWatts: boolean; // true = real power meter (not a Strava estimate)
}

/**
 * Pick the rides worth pulling power streams for: real-power-meter rides long
 * enough to contain a 20-min effort, ranked by normalized power (the hardest
 * first), capped to a handful to stay within Strava rate limits.
 */
export function pickFtpCandidates(rides: RideSummary[], max = 6): RideSummary[] {
  return rides
    .filter((r) => r.deviceWatts && r.durationSeconds >= 20 * 60 && (r.weightedAvgWatts ?? 0) > 0)
    .sort((a, b) => (b.weightedAvgWatts ?? 0) - (a.weightedAvgWatts ?? 0))
    .slice(0, max);
}

export type FtpConfidence = 'high' | 'medium' | 'low';

/** Turn a set of per-ride best-20-min FTP estimates into one result. */
export function combineFtpEstimates(perRideFtp: number[]): { ftpWatts: number; confidence: FtpConfidence; sampleSize: number } | null {
  const valid = perRideFtp.filter((f) => f > 0);
  if (valid.length === 0) return null;
  const ftpWatts = Math.max(...valid); // your best 20-min effort across recent rides
  const confidence: FtpConfidence = valid.length >= 3 ? 'high' : valid.length === 2 ? 'medium' : 'low';
  return { ftpWatts, confidence, sampleSize: valid.length };
}
