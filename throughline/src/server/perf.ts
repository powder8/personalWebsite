import 'server-only';
/**
 * Shared guards for per-run performance (Daniels VDOT) signals, so the fitness
 * anchor and the insights engine reject GPS glitches identically.
 *
 * GPS errors (short distance / dropped time) produce a single activity with an
 * absurd implied VDOT. Two complementary guards:
 *  - a robust ceiling (median + k·MAD) cuts egregious spikes, and
 *  - corroboration requires the effort to be backed by another strong effort
 *    nearby (a real fitness level is demonstrated more than once; a glitch is
 *    isolated). For the anchor we REQUIRE corroboration, which biases it
 *    slightly conservative — the safe direction (inflated anchors → too-fast
 *    paces; conservative ones don't hurt).
 */

export interface Effort {
  ts: number; // ms
  vdot: number;
}

/**
 * Is this a RACE-grade effort? A real race can't be a GPS glitch, so races are
 * exempt from the glitch guards (and should always surface as major efforts).
 *
 * We trust the provider's RACE FLAG (Strava workout_type = 1) and marathon
 * distance only — NOT the title. Name-matching produced false positives (a slow
 * "London marathon energy" shakeout read as a race); workout_type is the
 * reliable signal now that we capture it.
 */
export function isRaceEffort(opts: { workoutType: number | null; name: string | null; meters: number }): boolean {
  if (opts.workoutType === 1) return true;
  return opts.meters >= 40000; // marathon-distance — a major effort regardless
}

function med(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Robust upper bound on a believable VDOT for this athlete (median + k·MAD). */
export function vdotCeiling(vdots: number[], k = 4): number {
  if (vdots.length < 4) return Infinity; // too little data to judge outliers
  const m = med(vdots);
  const mad = med(vdots.map((v) => Math.abs(v - m))) || 1;
  return m + k * mad;
}

/** True if another effort within `windowDays` is within `tol` VDOT of this one. */
export function isCorroborated(
  effort: Effort,
  efforts: Effort[],
  windowDays = 28,
  tol = 5,
): boolean {
  const win = windowDays * 86400000;
  return efforts.some(
    (o) => o.ts !== effort.ts && Math.abs(o.ts - effort.ts) <= win && o.vdot >= effort.vdot - tol,
  );
}
