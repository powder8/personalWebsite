/**
 * Jack Daniels' VDOT pace model.
 *
 * VDOT is a VO2max-proxy fitness number derived from a recent race via the
 * Daniels–Gilbert equations. Training paces fall out by assigning each zone a
 * fraction of VDOT (a %VO2max band) and inverting the VO2↔velocity relation.
 *
 * The per-zone %VDOT bands ARE the customizable knobs (overall-model level);
 * per-athlete VDOT + per-zone overrides customize at the individual level
 * (see paceConfig.ts). This is an approximation of Daniels' published tables —
 * faithful in structure, and tunable to match a coach's judgement.
 */
import type { PaceZones, PaceRange, ZoneKey } from './types';

// Daniels–Gilbert: VO2 cost of running at velocity v (m/min).
function vo2AtVelocity(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

// Fraction of VO2max sustainable for a race lasting t minutes.
function pctMaxForDuration(t: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
}

// Invert vo2AtVelocity: velocity (m/min) for a target VO2.
function velocityForVo2(vo2: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export function vdotFromRace(race: { distanceMeters: number; timeSeconds: number }): number {
  const tMin = race.timeSeconds / 60;
  const v = race.distanceMeters / tMin; // m/min
  return vo2AtVelocity(v) / pctMaxForDuration(tMin);
}

/** sec/km for running at a given fraction of VDOT (%VO2max). */
export function paceForVdotFraction(vdot: number, fraction: number): number {
  const v = velocityForVo2(fraction * vdot); // m/min
  return 60000 / v; // sec per km
}

/** Per-zone %VDOT bands (fast bound = higher %). The overall-model knobs. */
export type VdotZoneModel = Record<ZoneKey, { fast: number; slow: number }>;

/**
 * Default bands, aligned to Daniels' E/M/T/I/R intensities, with two additions:
 *  - `recovery`: easier than E.
 *  - `maintenance`: the coach's steady zone between E and M (Daniels folds this
 *    into E; we keep it as a tunable sub-zone — the key reconciliation point).
 */
export const DEFAULT_VDOT_ZONES: VdotZoneModel = {
  recovery: { fast: 0.62, slow: 0.55 },
  easy: { fast: 0.74, slow: 0.62 },
  maintenance: { fast: 0.79, slow: 0.74 },
  marathon: { fast: 0.84, slow: 0.79 },
  threshold: { fast: 0.88, slow: 0.86 },
  interval: { fast: 1.0, slow: 0.97 },
  rep: { fast: 1.1, slow: 1.05 },
};

export function buildZonesFromVdot(vdot: number, model: VdotZoneModel = DEFAULT_VDOT_ZONES): PaceZones {
  const zones = {} as Record<ZoneKey, PaceRange>;
  (Object.keys(model) as ZoneKey[]).forEach((k) => {
    zones[k] = {
      fastSecPerKm: paceForVdotFraction(vdot, model[k].fast),
      slowSecPerKm: paceForVdotFraction(vdot, model[k].slow),
    };
  });
  // Threshold pace is the natural anchor for downstream display/parity.
  return { thresholdSecPerKm: (zones.threshold.fastSecPerKm + zones.threshold.slowSecPerKm) / 2, zones };
}
