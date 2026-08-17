/**
 * Pure guards for per-run performance (Daniels VDOT) signals, so the fitness
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
  return opts.meters >= 40000; // marathon-distance, a major effort regardless
}

/**
 * A sustained effort at near-maximal heart rate is unmistakably REAL — you can't
 * fake averaging ~90%+ of your max HR over a whole run, and a GPS glitch carries
 * no such physiological signature. So (like a race) it's trusted: exempt from the
 * corroboration/ceiling glitch guards, so a genuine isolated hard effort (e.g. a
 * parkrun that wasn't flagged as a race) still anchors fitness. Needs both avg
 * and max HR; the absolute floor guards against bad/low-HR data.
 */
export function isHardEffort(opts: { avgHr: number | null; maxHr: number | null }): boolean {
  const { avgHr, maxHr } = opts;
  if (avgHr == null || maxHr == null || maxHr <= 0) return false;
  return avgHr >= 140 && avgHr / maxHr >= 0.9;
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
