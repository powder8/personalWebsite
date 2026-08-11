/**
 * FTP — the cycling fitness anchor (the VDOT analog).
 *
 * FTP (Functional Threshold Power, watts) is the ~1-hour quasi-steady power that
 * approximates the power at lactate threshold. It is cycling's single fitness
 * number: the one scalar every training zone and load target is derived from,
 * exactly as VDOT is for running. This module mirrors `vdot.ts` + `paceConfig.ts`:
 *
 *   - a family of `ftpFrom*` pure estimators (ramp / 20-min / 8-min / 60-min /
 *     threshold ride / mean-maximal power curve via the Critical Power fit),
 *   - `resolveFtp(config, global)` — the anchor-precedence resolver, the twin of
 *     db/paceConfig.ts#getAthleteVdot (explicit → test-derived → null),
 *   - `resolvePowerZones(config, global)` — config → effective PowerZones, the
 *     twin of paceConfig.ts#resolvePaceZones.
 *
 * All test→FTP multipliers live in `GlobalPowerModel` so the coach can tune them.
 * Pure and DB-free (no `server-only` import). DB glue: src/db/powerConfig.ts.
 */
import type { PowerZones } from './types';
import {
  buildPowerZones,
  buildHrZones,
  DEFAULT_POWER_ZONES,
  DEFAULT_HR_ZONES,
  type PowerZoneModel,
  type HrZoneModel,
  type PowerZoneOverride,
} from './powerZonesLogic';
import type { PowerZoneKey } from './types';

/** A raw FTP test to derive an FTP from (see `ftpFromTest`). */
export interface FtpTest {
  kind: 'ramp' | 'twenty_min' | 'eight_min' | 'sixty_min' | 'threshold_ride' | 'power_curve';
  best1MinWatts?: number; // ramp
  avg20MinWatts?: number; // 20-min test / threshold ride
  avg8MinWatts?: number; // two 8-min efforts, averaged
  avg60MinWatts?: number; // 60-min TT / threshold ride (definitional)
  /** Mean-maximal power curve: best watts sustained for each duration. */
  powerCurve?: Array<{ durationSeconds: number; watts: number }>;
  date?: string;
}

/**
 * OVERALL cycling model (the global default; coach tunes once). Sibling of
 * `GlobalPaceModel`. Persisted in `engine_settings.powerModel`.
 */
export interface GlobalPowerModel {
  zones: PowerZoneModel; // Coggan %FTP defaults
  hrZones?: HrZoneModel; // %LTHR fallback bands
  // FTP-test → FTP multipliers (tunable):
  rampFactor?: number; // default 0.75 (× best 1-min power)
  twentyMinFactor?: number; // default 0.95 (× avg 20-min power)
  eightMinFactor?: number; // default 0.90 (× avg 8-min power)
  /** FTP = cpToFtp × CP from the Critical Power fit (CP ≈ 0.97–1.0 × FTP). */
  cpToFtp?: number; // default 1.0
}

export const DEFAULT_GLOBAL_POWER_MODEL: GlobalPowerModel = {
  zones: DEFAULT_POWER_ZONES,
  hrZones: DEFAULT_HR_ZONES,
  rampFactor: 0.75,
  twentyMinFactor: 0.95,
  eightMinFactor: 0.9,
  cpToFtp: 1.0,
};

/**
 * INDIVIDUAL athlete cycling config; every field optional, layered on the global
 * model. The power-side twin of `AthletePaceConfig`.
 */
export interface AthletePowerConfig {
  // --- fitness anchors (provide one; resolution order in resolveFtp) ---
  ftpWatts?: number; // explicit FTP (wins)
  ftpTest?: FtpTest; // a raw test to derive FTP from
  lthrBpm?: number; // lactate-threshold HR — enables the HR fallback
  weightKg?: number; // for W/kg display + climbing feasibility
  // --- provenance (identical semantics to paceConfig.anchorSource) ---
  anchorSource?: 'auto' | 'manual';
  // --- per-athlete overrides layered on the global model ---
  bandOverrides?: Partial<PowerZoneModel>; // custom %FTP bands
  zoneOverrides?: Partial<Record<PowerZoneKey, PowerZoneOverride>>; // final watt nudges
  hrBandOverrides?: Partial<HrZoneModel>; // custom %LTHR bands
  // --- rider strength bias (sprinter ↔ time-triallist), the McMillan analog ---
  strengthBias?: number; // [-1, +1]: +1 punchy/anaerobic, -1 diesel/threshold
}

// --- FTP estimators (the `vdotFrom*` analogs) ---

const round = (w: number) => Math.round(w);

/** Ramp test: FTP = rampFactor × best rolling 1-min power (TrainerRoad/Zwift). */
export function ftpFromRamp(best1MinWatts: number, rampFactor = 0.75): number {
  return round(best1MinWatts * rampFactor);
}

/** 20-min field test: FTP = twentyMinFactor × avg 20-min power (Allen & Coggan). */
export function ftpFromTwentyMin(avg20MinWatts: number, twentyMinFactor = 0.95): number {
  return round(avg20MinWatts * twentyMinFactor);
}

/** 8-min test (Carmichael): FTP = eightMinFactor × avg of two 8-min efforts. */
export function ftpFromEightMin(avg8MinWatts: number, eightMinFactor = 0.9): number {
  return round(avg8MinWatts * eightMinFactor);
}

/** 60-min TT / steady threshold ride: FTP = avg 60-min power (definitional). */
export function ftpFromSixtyMin(avg60MinWatts: number): number {
  return round(avg60MinWatts);
}

/**
 * Critical Power 2-parameter fit — P(t) = W'/t + CP (Monod & Scherrer 1965).
 * Linear regression of best power P against 1/t over efforts (ideally ~3–20 min);
 * the intercept is CP, the slope is W'. Then FTP ≈ cpToFtp × CP. Returns null if
 * fewer than two distinct durations are supplied (fit is under-determined).
 *
 * This is the cycling twin of deriving VDOT from the hardest sustained block —
 * a duration/power sliding-window instead of distance/pace.
 */
export function criticalPowerFit(
  curve: Array<{ durationSeconds: number; watts: number }>,
): { cp: number; wPrime: number } | null {
  const pts = curve.filter((p) => p.durationSeconds > 0 && p.watts > 0);
  const distinct = new Set(pts.map((p) => p.durationSeconds));
  if (pts.length < 2 || distinct.size < 2) return null;
  // x = 1/t, y = P. Slope = W', intercept = CP.
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const x = 1 / p.durationSeconds;
    const y = p.watts;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const wPrime = (n * sxy - sx * sy) / denom;
  const cp = (sy - wPrime * sx) / n;
  if (!Number.isFinite(cp) || cp <= 0) return null;
  return { cp, wPrime };
}

export function ftpFromPowerCurve(
  curve: Array<{ durationSeconds: number; watts: number }>,
  cpToFtp = 1.0,
): number | null {
  const fit = criticalPowerFit(curve);
  return fit ? round(fit.cp * cpToFtp) : null;
}

/** Dispatch an `FtpTest` to the right estimator using the global multipliers. */
export function ftpFromTest(
  test: FtpTest,
  global: GlobalPowerModel = DEFAULT_GLOBAL_POWER_MODEL,
): number | null {
  switch (test.kind) {
    case 'ramp':
      return test.best1MinWatts != null
        ? ftpFromRamp(test.best1MinWatts, global.rampFactor ?? 0.75)
        : null;
    case 'twenty_min':
      return test.avg20MinWatts != null
        ? ftpFromTwentyMin(test.avg20MinWatts, global.twentyMinFactor ?? 0.95)
        : null;
    case 'eight_min':
      return test.avg8MinWatts != null
        ? ftpFromEightMin(test.avg8MinWatts, global.eightMinFactor ?? 0.9)
        : null;
    case 'sixty_min':
      return test.avg60MinWatts != null ? ftpFromSixtyMin(test.avg60MinWatts) : null;
    case 'threshold_ride':
      // A true ~1 h effort is definitional; a ~20 min effort discounts by 0.95.
      if (test.avg60MinWatts != null) return ftpFromSixtyMin(test.avg60MinWatts);
      if (test.avg20MinWatts != null)
        return ftpFromTwentyMin(test.avg20MinWatts, global.twentyMinFactor ?? 0.95);
      return null;
    case 'power_curve':
      return test.powerCurve ? ftpFromPowerCurve(test.powerCurve, global.cpToFtp ?? 1.0) : null;
    default: {
      const _exhaustive: never = test.kind;
      throw new Error(`ftpFromTest: unknown test kind ${String(_exhaustive)}`);
    }
  }
}

/**
 * Resolve the single FTP anchor from config — the twin of getAthleteVdot.
 * Precedence: explicit ftpWatts → test-derived → null. As on the pace side the
 * anchor is taken DIRECTLY from the fitness signal, never re-derived from the
 * (bias/override-carrying) training zones. Null means "no FTP" — the caller
 * falls back to the HR (%LTHR) zones if `lthrBpm` is set, else to nothing.
 */
export function resolveFtp(
  config: AthletePowerConfig,
  global: GlobalPowerModel = DEFAULT_GLOBAL_POWER_MODEL,
): number | null {
  if (config.ftpWatts != null) return config.ftpWatts;
  if (config.ftpTest) return ftpFromTest(config.ftpTest, global);
  return null;
}

/**
 * Resolve effective cycling zones for an athlete = global power model + their
 * powerConfig. Returns %FTP watt zones when an FTP anchor exists; falls back to
 * %LTHR heart-rate zones when only `lthrBpm` is set. The power-side twin of
 * resolvePaceZones. Throws only when NO anchor (neither FTP nor LTHR) exists.
 */
export function resolvePowerZones(
  config: AthletePowerConfig,
  global: GlobalPowerModel = DEFAULT_GLOBAL_POWER_MODEL,
): PowerZones {
  const ftp = resolveFtp(config, global);
  if (ftp != null) {
    return buildPowerZones(ftp, {
      model: global.zones ?? DEFAULT_POWER_ZONES,
      bandOverrides: config.bandOverrides,
      strengthBias: config.strengthBias,
      zoneOverrides: config.zoneOverrides,
      lthrBpm: config.lthrBpm,
      hrModel: { ...(global.hrZones ?? DEFAULT_HR_ZONES), ...(config.hrBandOverrides ?? {}) },
    });
  }
  if (config.lthrBpm != null) {
    return buildHrZones(config.lthrBpm, { ...(global.hrZones ?? DEFAULT_HR_ZONES), ...(config.hrBandOverrides ?? {}) });
  }
  throw new Error('resolvePowerZones: no fitness anchor (need ftpWatts, ftpTest, or lthrBpm)');
}
