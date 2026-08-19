/**
 * Pace zones derived from an athlete's OWN fitness — never absolute paces.
 *
 * The model is threshold-anchored: every zone is an offset (in s/km) from the
 * athlete's lactate-threshold pace. The default offsets are calibrated to
 * reproduce the coach's zones for an elite athlete (e.g. threshold ≈ 5:58/mi →
 * maintenance ≈ 7:10/mi), but because they're offsets from the athlete's own
 * threshold, the same model produces correct zones for a 4-hour marathoner too.
 *
 * Threshold can be supplied directly (the coach often knows it) or estimated
 * from a recent race via Riegel.
 */
import type { PaceZones, PaceRange, ZoneKey } from './types';

const MItoKM = 1.609344;

/** Offsets from threshold in SECONDS PER KM. Negative = faster than threshold. */
export interface ZoneModel {
  offsets: Record<ZoneKey, { fast: number; slow: number }>;
}

/**
 * Default offsets, calibrated against the coach's elite athlete:
 *   threshold ~5:58/mi (222.5 s/km); maintenance ~7:10/mi (267 s/km) → +44 s/km;
 *   reps ~5:40/mi → ~-11 s/km; marathon ~+17 s/km; easy/recovery progressively
 *   slower. These match her prescriptions and scale by threshold.
 */
export const DEFAULT_ZONE_MODEL: ZoneModel = {
  offsets: {
    rep: { fast: -20, slow: -8 },
    interval: { fast: -11, slow: -3 },
    threshold: { fast: -4, slow: 4 },
    marathon: { fast: 11, slow: 21 },
    maintenance: { fast: 38, slow: 50 },
    easy: { fast: 50, slow: 70 },
    recovery: { fast: 66, slow: 92 },
  },
};

export function buildZones(
  thresholdSecPerKm: number,
  model: ZoneModel = DEFAULT_ZONE_MODEL,
): PaceZones {
  const zones = {} as Record<ZoneKey, PaceRange>;
  (Object.keys(model.offsets) as ZoneKey[]).forEach((k) => {
    const o = model.offsets[k];
    zones[k] = {
      fastSecPerKm: thresholdSecPerKm + o.fast,
      slowSecPerKm: thresholdSecPerKm + o.slow,
    };
  });
  return { thresholdSecPerKm, zones };
}

/**
 * Riegel race-time prediction: t2 = t1 · (d2/d1)^1.06. Used to convert any race
 * to an equivalent 10K, whose pace (×1.03) approximates lactate threshold.
 */
const RIEGEL_EXP = 1.06;

export function estimateThresholdSecPerKm(race: {
  distanceMeters: number;
  timeSeconds: number;
}): number {
  const t10k = race.timeSeconds * Math.pow(10000 / race.distanceMeters, RIEGEL_EXP);
  const pace10kSecPerKm = t10k / 10;
  return pace10kSecPerKm * 1.03; // threshold is slightly slower than 10K pace
}

export function midpoint(range: PaceRange): number {
  return (range.fastSecPerKm + range.slowSecPerKm) / 2;
}

// --- display helpers (coach reads min/mile + miles) ---

export function secPerKmToMinPerMile(secPerKm: number): string {
  const secPerMile = secPerKm * MItoKM;
  const m = Math.floor(secPerMile / 60);
  const s = Math.round(secPerMile - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function paceRangeLabel(range: PaceRange): string {
  return `${secPerKmToMinPerMile(range.fastSecPerKm)}-${secPerKmToMinPerMile(range.slowSecPerKm)}/mi`;
}

export function metersToMiles(m: number): number {
  return m / 1000 / MItoKM;
}

export function milesToMeters(mi: number): number {
  return mi * MItoKM * 1000;
}
