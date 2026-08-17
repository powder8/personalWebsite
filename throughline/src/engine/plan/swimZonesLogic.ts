/**
 * Swim pace zones derived from an athlete's OWN CSS — never absolute times.
 *
 * The swim-side twin of `powerZonesLogic.ts` / `zones.ts`. Cycling zones are
 * %FTP (multiplicative watt bands); swim zones are conventionally sec/100 m
 * OFFSETS from CSS pace (additive, in the pace domain — the Swim Smooth / Friel
 * convention). This matches how the run engine thinks in sec/km offsets from
 * threshold, so swim reuses the pace-offset mental model, not the %-of-anchor
 * one. CSS is stored as m/s; convert once to CSS pace `100 / cssMetersPerSec`
 * (sec/100 m), then each band is `cssPace + offset`.
 *
 * There is NO HR fallback on the swim side (swim HR is unreliable — see
 * swim-foundation-spec.md §4): with no CSS anchor there are simply no zones.
 *
 * Pure and DB-free (no `server-only` import). DB glue: src/db/swimConfig.ts;
 * per-athlete resolution glue (resolveSwimZones): cssLogic.ts.
 */
import type { SwimZoneKey, SwimRange, SwimZones, TrainingZones } from './types';

/** Per-zone sec/100 m offset band from CSS pace (fast = negative offset). */
export type SwimZoneModel = Record<SwimZoneKey, { loOffset: number; hiOffset: number }>;

/**
 * Default CSS-relative pace bands (Swim Smooth / Friel starting values), tunable
 * global→athlete exactly like `DEFAULT_POWER_ZONES`. Offsets are sec/100 m from
 * CSS pace; the `threshold` band straddles CSS (the anchor).
 */
export const DEFAULT_SWIM_ZONES: SwimZoneModel = {
  recovery: { loOffset: +10, hiOffset: +20 }, // CSS + 10-20 s/100
  aerobic: { loOffset: +4, hiOffset: +10 }, // CSS + 4-10 s/100
  threshold: { loOffset: -2, hiOffset: +2 }, // CSS ± 2 s/100 (the anchor)
  vo2max: { loOffset: -6, hiOffset: -2 }, // CSS − 2-6 s/100
  sprint: { loOffset: -12, hiOffset: -6 }, // CSS − 6 s/100 and faster
};

const SWIM_ZONE_KEYS = Object.keys(DEFAULT_SWIM_ZONES) as SwimZoneKey[];

/**
 * Stroke strength bias in [-1, +1] (the McMillan/`strengthBias` analog):
 *   +1 = fast/sprint-biased → shift sprint & vo2max faster, aerobic slower;
 *   -1 = diesel/distance-biased → the reverse.
 * Values are the sec/100 m tilt applied to each offset at |bias| = 1 (negative
 * = faster). Applied to both bounds so the band shifts rather than distorts.
 */
const STRENGTH_TILT: Partial<Record<SwimZoneKey, { lo: number; hi: number }>> = {
  aerobic: { lo: +2, hi: +2 }, // distance type (bias<0) pulls aerobic faster
  vo2max: { lo: -1.5, hi: -1.5 },
  sprint: { lo: -3, hi: -3 }, // sprint type (bias>0) sharpens the top end
};

function applyStrengthBias(model: SwimZoneModel, bias: number): SwimZoneModel {
  if (!bias) return model;
  const b = Math.max(-1, Math.min(1, bias));
  const out = {} as SwimZoneModel;
  for (const k of SWIM_ZONE_KEYS) {
    const tilt = STRENGTH_TILT[k];
    out[k] = tilt
      ? { loOffset: model[k].loOffset + tilt.lo * b, hiOffset: model[k].hiOffset + tilt.hi * b }
      : { ...model[k] };
  }
  return out;
}

/** Per-athlete overrides on the built sec/100 m bands (mirror of `PowerZoneOverride`). */
export interface SwimZoneOverride {
  /** Replace a bound outright (sec/100 m). */
  fastSecPer100?: number;
  slowSecPer100?: number;
  /** Or shift it (sec/100 m; positive = slower). */
  fastAdjust?: number;
  slowAdjust?: number;
}

function applyOverride(range: SwimRange, o: SwimZoneOverride | undefined): SwimRange {
  if (!o) return range;
  return {
    fastSecPer100: o.fastSecPer100 ?? range.fastSecPer100 + (o.fastAdjust ?? 0),
    slowSecPer100: o.slowSecPer100 ?? range.slowSecPer100 + (o.slowAdjust ?? 0),
  };
}

export interface BuildSwimZonesOptions {
  model?: SwimZoneModel;
  /** Per-athlete sec/100 m offset overrides merged onto the base model. */
  bandOverrides?: Partial<SwimZoneModel>;
  /** Stroke strength bias in [-1, +1]. */
  strengthBias?: number;
  /** Final per-zone sec/100 m nudges, applied after offsets → paces. */
  zoneOverrides?: Partial<Record<SwimZoneKey, SwimZoneOverride>>;
}

/** CSS pace in sec/100 m for display (the `wattsLabel` analog input). */
export function cssPaceSecPer100(cssMetersPerSec: number): number {
  return cssMetersPerSec > 0 ? 100 / cssMetersPerSec : 0;
}

/**
 * Build sec/100 m swim zones from a CSS anchor (the `buildPowerZones` analog).
 * Each band is `cssPace + offset`; `fast` is the smaller (quicker) sec/100 m.
 * Returns a `SwimZones` tagged `kind: 'swim'`.
 */
export function buildSwimZones(cssMetersPerSec: number, opts: BuildSwimZonesOptions = {}): SwimZones {
  const cssPace = cssPaceSecPer100(cssMetersPerSec);
  const merged: SwimZoneModel = { ...(opts.model ?? DEFAULT_SWIM_ZONES), ...(opts.bandOverrides ?? {}) };
  const biased = opts.strengthBias ? applyStrengthBias(merged, opts.strengthBias) : merged;

  const zones = {} as Record<SwimZoneKey, SwimRange>;
  for (const k of SWIM_ZONE_KEYS) {
    const { loOffset, hiOffset } = biased[k];
    let range: SwimRange = {
      fastSecPer100: cssPace + Math.min(loOffset, hiOffset),
      slowSecPer100: cssPace + Math.max(loOffset, hiOffset),
    };
    range = applyOverride(range, opts.zoneOverrides?.[k]);
    zones[k] = range;
  }

  return { kind: 'swim', cssMetersPerSec, cssPaceSecPer100: cssPace, zones };
}

// --- narrowing + display helpers ---

export function isSwimZones(z: TrainingZones): z is SwimZones {
  return (z as SwimZones).kind === 'swim';
}

/** Format sec/100 m as `m:ss` (coach's pace notation), e.g. 95 → "1:35". */
export function formatSecPer100(secPer100: number): string {
  const total = Math.round(secPer100);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Display twin of `wattsLabel` — "1:35–1:42 /100m". */
export function swimPaceLabel(range: SwimRange): string {
  return `${formatSecPer100(range.fastSecPer100)}-${formatSecPer100(range.slowSecPer100)} /100m`;
}
