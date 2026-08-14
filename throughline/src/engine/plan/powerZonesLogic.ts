/**
 * Power + HR zones derived from an athlete's OWN fitness — never absolute watts.
 *
 * The power-side twin of `zones.ts`/`vdot.ts`. Every band is a %FTP fraction
 * (Coggan 7-zone model); multiply FTP by each band's bounds to get watt targets.
 * When an athlete has no power meter we fall back to %LTHR heart-rate bands
 * (Coggan/Friel), which are only meaningful up to ~threshold (HR saturates and
 * lags above it, so the top zones there are prescribe-by-RPE placeholders).
 *
 * Pure and DB-free (no `server-only` import). The DB glue lives in
 * `src/db/powerConfig.ts`; the per-athlete resolution glue lives in `ftpLogic.ts`.
 */
import type {
  PowerZoneKey,
  PowerRange,
  HrRange,
  PowerZones,
  PaceZones,
  TrainingZones,
} from './types';

/** Per-zone %-of-anchor bounds (fractions). Used for both %FTP and %LTHR bands. */
export type BandModel = Record<PowerZoneKey, { lo: number; hi: number }>;
export type PowerZoneModel = BandModel; // %FTP
export type HrZoneModel = BandModel; // %LTHR

/**
 * Coggan 7-zone %FTP model (Allen & Coggan, *Training and Racing with a Power
 * Meter*), plus the coach-added `sweetspot` band (88–94% FTP). `sprint` `hi` is
 * a display cap only — neuromuscular efforts are uncapped in reality.
 *
 * NOTE `sweetspot` overlaps `tempo`/`threshold` on purpose: it is a training
 * band, not a slice of a mutually exclusive tiling. Downstream code that asks
 * "which single zone was this?" must treat it as an alias, not a partition.
 */
export const DEFAULT_POWER_ZONES: PowerZoneModel = {
  recovery: { lo: 0.0, hi: 0.55 },
  endurance: { lo: 0.56, hi: 0.75 },
  tempo: { lo: 0.76, hi: 0.9 },
  sweetspot: { lo: 0.88, hi: 0.94 },
  threshold: { lo: 0.91, hi: 1.05 },
  vo2max: { lo: 1.06, hi: 1.2 },
  anaerobic: { lo: 1.21, hi: 1.5 },
  sprint: { lo: 1.5, hi: 3.0 }, // hi = display cap only
};

/**
 * Coggan %LTHR heart-rate bands for the no-power-meter fallback. HR is only
 * meaningful up to ~threshold, so Z5+ collapse into a narrow "above threshold —
 * unreliable, prescribe by RPE/duration" region rather than distinct ceilings.
 */
export const DEFAULT_HR_ZONES: HrZoneModel = {
  recovery: { lo: 0.0, hi: 0.68 },
  endurance: { lo: 0.69, hi: 0.83 },
  tempo: { lo: 0.84, hi: 0.94 },
  sweetspot: { lo: 0.88, hi: 0.94 },
  threshold: { lo: 0.95, hi: 1.05 },
  // Above threshold HR saturates/lags — these are placeholders, not true bands.
  vo2max: { lo: 1.06, hi: 1.1 },
  anaerobic: { lo: 1.06, hi: 1.15 },
  sprint: { lo: 1.06, hi: 1.2 },
};

const POWER_ZONE_KEYS = Object.keys(DEFAULT_POWER_ZONES) as PowerZoneKey[];

/**
 * Rider strength bias in [-1, +1] (the McMillan/`strengthBias` analog):
 *   +1 = punchy/sprinter → lift the anaerobic & sprint ceilings, trim threshold;
 *   -1 = diesel/time-triallist → the reverse.
 * Values are the %FTP tilt applied to each bound at |bias| = 1.
 */
const STRENGTH_TILT: Partial<Record<PowerZoneKey, { lo: number; hi: number }>> = {
  threshold: { lo: -0.02, hi: -0.02 }, // TT type raises threshold when bias < 0
  anaerobic: { lo: 0.05, hi: 0.08 },
  sprint: { lo: 0.1, hi: 0.15 },
};

function applyStrengthBias(model: PowerZoneModel, bias: number): PowerZoneModel {
  if (!bias) return model;
  const b = Math.max(-1, Math.min(1, bias));
  const out = {} as PowerZoneModel;
  for (const k of POWER_ZONE_KEYS) {
    const tilt = STRENGTH_TILT[k];
    out[k] = tilt
      ? { lo: model[k].lo + tilt.lo * b, hi: model[k].hi + tilt.hi * b }
      : { ...model[k] };
  }
  return out;
}

/** Per-athlete overrides on the built watt bands (mirror of pace `ZoneOverride`). */
export interface PowerZoneOverride {
  /** Replace a bound outright (watts). */
  loWatts?: number;
  hiWatts?: number;
  /** Or shift it (watts; positive = harder). */
  loAdjust?: number;
  hiAdjust?: number;
}

function applyOverride(range: PowerRange, o: PowerZoneOverride | undefined): PowerRange {
  if (!o) return range;
  return {
    loWatts: o.loWatts ?? range.loWatts + (o.loAdjust ?? 0),
    hiWatts: o.hiWatts ?? range.hiWatts + (o.hiAdjust ?? 0),
  };
}

export interface BuildPowerZonesOptions {
  model?: PowerZoneModel;
  /** Per-athlete %FTP band overrides merged onto the base model. */
  bandOverrides?: Partial<PowerZoneModel>;
  /** Rider strength bias in [-1, +1]. */
  strengthBias?: number;
  /** Final per-zone watt nudges, applied after bands → watts. */
  zoneOverrides?: Partial<Record<PowerZoneKey, PowerZoneOverride>>;
  /** LTHR (bpm): when set, HR bands are attached as a SECONDARY cue. */
  lthrBpm?: number;
  hrModel?: HrZoneModel;
}

/**
 * Build %FTP watt zones from an FTP anchor (the `buildZones`/`buildZonesFromVdot`
 * analog). Returns a `PowerZones` with `basis: 'ftp'`.
 */
export function buildPowerZones(ftpWatts: number, opts: BuildPowerZonesOptions = {}): PowerZones {
  const merged: PowerZoneModel = { ...(opts.model ?? DEFAULT_POWER_ZONES), ...(opts.bandOverrides ?? {}) };
  const biased = opts.strengthBias ? applyStrengthBias(merged, opts.strengthBias) : merged;

  const zones = {} as Record<PowerZoneKey, PowerRange>;
  for (const k of POWER_ZONE_KEYS) {
    let range: PowerRange = {
      loWatts: Math.round(ftpWatts * biased[k].lo),
      hiWatts: Math.round(ftpWatts * biased[k].hi),
    };
    range = applyOverride(range, opts.zoneOverrides?.[k]);
    zones[k] = range;
  }

  const hrZones = opts.lthrBpm != null ? buildHrBands(opts.lthrBpm, opts.hrModel ?? DEFAULT_HR_ZONES) : null;
  return { kind: 'power', basis: 'ftp', ftpWatts, lthrBpm: opts.lthrBpm ?? null, zones, hrZones };
}

function buildHrBands(lthrBpm: number, model: HrZoneModel): Record<PowerZoneKey, HrRange> {
  const out = {} as Record<PowerZoneKey, HrRange>;
  for (const k of POWER_ZONE_KEYS) {
    out[k] = { loBpm: Math.round(lthrBpm * model[k].lo), hiBpm: Math.round(lthrBpm * model[k].hi) };
  }
  return out;
}

/**
 * Build %LTHR heart-rate zones for an athlete with NO power meter (the HR
 * fallback). Returns a `PowerZones` with `basis: 'lthr'`, watt `zones` null and
 * `hrZones` populated as the primary prescription.
 */
export function buildHrZones(lthrBpm: number, model: HrZoneModel = DEFAULT_HR_ZONES): PowerZones {
  return {
    kind: 'power',
    basis: 'lthr',
    ftpWatts: null,
    lthrBpm,
    zones: null,
    hrZones: buildHrBands(lthrBpm, model),
  };
}

// --- narrowing + display helpers ---

export function isPowerZones(z: TrainingZones): z is PowerZones {
  return (z as PowerZones).kind === 'power';
}

export function isPaceZones(z: TrainingZones): z is PaceZones {
  // Pace zones are the untagged running arm: no `kind` discriminant at all (the
  // power arm is 'power', the swim arm is 'swim'). Checking for the ABSENCE of a
  // kind keeps running byte-identical while excluding both tagged arms.
  return (z as { kind?: string }).kind === undefined;
}

/** Display twin of `paceRangeLabel` — "250–290 W". */
export function wattsLabel(range: PowerRange): string {
  return `${Math.round(range.loWatts)}–${Math.round(range.hiWatts)} W`;
}

/** Watts per kilogram at a bound, for display + climbing feasibility. */
export function wattsPerKg(watts: number, weightKg: number): number {
  return weightKg > 0 ? watts / weightKg : 0;
}

export function bpmLabel(range: HrRange): string {
  return `${Math.round(range.loBpm)}–${Math.round(range.hiBpm)} bpm`;
}
