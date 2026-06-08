/**
 * Two-level pace customization.
 *
 *   global model defaults  →  per-athlete overrides  →  effective PaceZones
 *
 * The coach tunes the OVERALL model (which anchor, the per-zone bands) once, and
 * customizes INDIVIDUAL athletes on top (their VDOT/threshold, plus per-zone
 * nudges). Both are plain JSON so they persist (athletes.paceConfig and the
 * engineSettings global row) and are editable from the console.
 *
 * Output is always a PaceZones, so the rest of the plan engine is unchanged.
 */
import type { PaceZones, PaceRange, ZoneKey } from './types';
import { buildZones, DEFAULT_ZONE_MODEL, estimateThresholdSecPerKm, type ZoneModel } from './zones';
import { buildZonesFromVdot, vdotFromRace, DEFAULT_VDOT_ZONES, type VdotZoneModel } from './vdot';

export type PaceModelKind = 'vdot' | 'threshold_offset';

/** A nudge applied to a zone after the base model builds it. */
export interface ZoneOverride {
  /** Replace the bound outright (sec/km). */
  fastSecPerKm?: number;
  slowSecPerKm?: number;
  /** Or shift it (sec/km; negative = faster). */
  fastAdjust?: number;
  slowAdjust?: number;
}

/** OVERALL-model configuration (the global default; the coach tunes this once). */
export interface GlobalPaceModel {
  kind: PaceModelKind;
  vdotZones?: VdotZoneModel; // when kind = 'vdot'
  offsets?: ZoneModel['offsets']; // when kind = 'threshold_offset'
}

export const DEFAULT_GLOBAL_MODEL: GlobalPaceModel = {
  kind: 'vdot',
  vdotZones: DEFAULT_VDOT_ZONES,
  offsets: DEFAULT_ZONE_MODEL.offsets,
};

/** INDIVIDUAL athlete configuration; every field optional, layered on the global. */
export interface AthletePaceConfig {
  /** Override the model kind for this athlete. */
  kind?: PaceModelKind;
  /** Fitness anchors (provide one; or a race to derive from). */
  vdot?: number;
  thresholdSecPerKm?: number;
  race?: { distanceMeters: number; timeSeconds: number };
  /**
   * Whether the anchor was inferred from activity history ('auto') or set/
   * confirmed by a human ('manual'). Auto anchors are refreshed as new data
   * arrives; manual anchors are left untouched until a human changes them.
   */
  anchorSource?: 'auto' | 'manual';
  /** Per-zone band overrides for this athlete (merged onto the global bands). */
  vdotZones?: Partial<VdotZoneModel>;
  offsets?: Partial<ZoneModel['offsets']>;
  /** Final per-zone pace nudges, applied after the base zones are built. */
  zoneOverrides?: Partial<Record<ZoneKey, ZoneOverride>>;
  /**
   * Endurance↔speed bias in [-1, +1] (McMillan-style strength), applied to the
   * Daniels base: +1 = speed type (faster short reps, slower marathon-pace);
   * -1 = endurance type (slower short reps, faster marathon-pace).
   */
  strengthBias?: number;
  /**
   * Athlete age in years (from DOB). When set and ≥ the masters threshold, the
   * default threshold pace is eased (masters recover/clear lactate slower). Pure
   * default — a coach override via zoneOverrides still wins.
   */
  ageYears?: number;
}

// --- Masters defaults (Heather's coaching call; tunable here) -----------------
/** Age at which the masters threshold easing kicks in. */
export const MASTERS_AGE = 40;
/** Default threshold easing at the masters boundary (Heather's ~15s/mi). */
export const MASTERS_THRESHOLD_BASE_SEC_PER_MILE = 15;
/** Additional easing per year beyond the masters boundary. */
export const MASTERS_THRESHOLD_PER_YEAR_SEC_PER_MILE = 0.7;
const SEC_PER_MILE_TO_SEC_PER_KM = 1 / 1.609344;

/**
 * How much slower (s/mi) a masters athlete's default threshold pace should run,
 * given age. 0 below the masters age; a base accommodation at the boundary that
 * grows modestly with age. Heather-tunable.
 */
export function mastersThresholdEaseSecPerMile(ageYears: number | null | undefined): number {
  if (ageYears == null || ageYears < MASTERS_AGE) return 0;
  return MASTERS_THRESHOLD_BASE_SEC_PER_MILE + MASTERS_THRESHOLD_PER_YEAR_SEC_PER_MILE * (ageYears - MASTERS_AGE);
}

/** Whole-years age from a 'YYYY-MM-DD' DOB as of 'YYYY-MM-DD' today. Null if unknown/invalid. */
export function ageFromDob(dob: string | null | undefined, today: string): number | null {
  if (!dob) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  if (!by || !ty) return null;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Ease the threshold zone for masters, clamped so it never crosses marathon pace. */
function applyMastersEase(zones: PaceZones, ageYears: number | undefined): PaceZones {
  const easeMi = mastersThresholdEaseSecPerMile(ageYears);
  if (easeMi <= 0) return zones;
  const ease = easeMi * SEC_PER_MILE_TO_SEC_PER_KM; // s/km, positive = slower
  const t = zones.zones.threshold;
  const m = zones.zones.marathon;
  // Threshold must stay at least 1 s/km faster (smaller) than marathon pace.
  const capFast = m.fastSecPerKm - 1;
  const capSlow = m.slowSecPerKm - 1;
  const threshold = {
    fastSecPerKm: Math.min(t.fastSecPerKm + ease, capFast),
    slowSecPerKm: Math.min(t.slowSecPerKm + ease, capSlow),
  };
  return { ...zones, zones: { ...zones.zones, threshold } };
}

/** Max pace tilt (s/km) at |bias| = 1, per zone. Speed type makes reps faster. */
const STRENGTH_TILT: Partial<Record<ZoneKey, number>> = {
  rep: -12, // faster when bias > 0
  interval: -7,
  marathon: 9, // slower when bias > 0
  maintenance: 5,
};

function applyStrengthBias(zones: PaceZones, bias: number): PaceZones {
  if (!bias) return zones;
  const b = Math.max(-1, Math.min(1, bias));
  const out = { ...zones.zones };
  for (const k of Object.keys(STRENGTH_TILT) as ZoneKey[]) {
    const shift = (STRENGTH_TILT[k] ?? 0) * b;
    out[k] = { fastSecPerKm: out[k].fastSecPerKm + shift, slowSecPerKm: out[k].slowSecPerKm + shift };
  }
  return { ...zones, zones: out };
}

function applyOverride(range: PaceRange, o: ZoneOverride | undefined): PaceRange {
  if (!o) return range;
  return {
    fastSecPerKm: o.fastSecPerKm ?? range.fastSecPerKm + (o.fastAdjust ?? 0),
    slowSecPerKm: o.slowSecPerKm ?? range.slowSecPerKm + (o.slowAdjust ?? 0),
  };
}

/**
 * Resolve effective pace zones for an athlete. Throws only if no fitness anchor
 * can be determined for the chosen model.
 */
export function resolvePaceZones(
  athlete: AthletePaceConfig,
  global: GlobalPaceModel = DEFAULT_GLOBAL_MODEL,
): PaceZones {
  const kind = athlete.kind ?? global.kind;

  let base: PaceZones;
  if (kind === 'vdot') {
    const vdot =
      athlete.vdot ??
      (athlete.race ? vdotFromRace(athlete.race) : undefined) ??
      (athlete.thresholdSecPerKm ? vdotFromThreshold(athlete.thresholdSecPerKm) : undefined);
    if (vdot == null) throw new Error('resolvePaceZones: VDOT model needs vdot, race, or threshold');
    const bands: VdotZoneModel = { ...(global.vdotZones ?? DEFAULT_VDOT_ZONES), ...(athlete.vdotZones ?? {}) };
    base = buildZonesFromVdot(vdot, bands);
  } else {
    const threshold =
      athlete.thresholdSecPerKm ??
      (athlete.race ? estimateThresholdSecPerKm(athlete.race) : undefined);
    if (threshold == null) throw new Error('resolvePaceZones: threshold model needs threshold or race');
    const offsets = { ...(global.offsets ?? DEFAULT_ZONE_MODEL.offsets), ...(athlete.offsets ?? {}) };
    base = buildZones(threshold, { offsets });
  }

  // Strength bias (endurance↔speed) tilts short-rep vs marathon paces.
  if (athlete.strengthBias) base = applyStrengthBias(base, athlete.strengthBias);

  // Masters default: ease the threshold pace by age (before coach overrides, so
  // an explicit zoneOverride still wins).
  base = applyMastersEase(base, athlete.ageYears);

  // Apply final per-zone nudges (individual level).
  if (athlete.zoneOverrides) {
    const zones = { ...base.zones };
    for (const k of Object.keys(athlete.zoneOverrides) as ZoneKey[]) {
      zones[k] = applyOverride(zones[k], athlete.zoneOverrides[k]);
    }
    base = { ...base, zones };
  }
  return base;
}

/** Approximate VDOT from a threshold pace (treat threshold as ~1hr race effort). */
export function vdotFromThreshold(thresholdSecPerKm: number): number {
  // 60-minute effort distance at this pace, fed back through the race formula.
  const distanceMeters = (3600 / thresholdSecPerKm) * 1000;
  return vdotFromRace({ distanceMeters, timeSeconds: 3600 });
}
