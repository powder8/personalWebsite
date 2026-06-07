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
  /** Per-zone band overrides for this athlete (merged onto the global bands). */
  vdotZones?: Partial<VdotZoneModel>;
  offsets?: Partial<ZoneModel['offsets']>;
  /** Final per-zone pace nudges, applied after the base zones are built. */
  zoneOverrides?: Partial<Record<ZoneKey, ZoneOverride>>;
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
