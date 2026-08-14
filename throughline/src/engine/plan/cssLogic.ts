/**
 * CSS — the swimming fitness anchor (the VDOT/FTP analog).
 *
 * Critical Swim Speed (CSS, m/s) is the swim threshold: the fastest velocity an
 * athlete can hold in a quasi-steady state — the swim analog of running
 * threshold pace and cycling FTP. It is the critical-velocity asymptote of the
 * swimmer's distance–time curve (the two-parameter critical-power model applied
 * to swimming). This module mirrors `ftpLogic.ts` + `paceConfig.ts`:
 *
 *   - a family of `cssFrom*` pure estimators (400/200 Wakayoshi, generic
 *     two-distance, least-squares velocity curve, single time-trial),
 *   - `resolveCss(config, global)` — the anchor-precedence resolver, the twin of
 *     `resolveFtp` / `getAthleteVdot` (explicit → test-derived → null),
 *   - `resolveSwimZones(config, global)` — config → effective SwimZones, the
 *     twin of `resolvePowerZones` / `resolvePaceZones`.
 *
 * CSS is stored internally as m/s, matching `SwimSession.cssMetersPerSec` and
 * `LoadAnchors.cssMetersPerSec` in loadCurrencyLogic.ts, so no unit conversion
 * happens at the load boundary. Coaches read swim pace as sec/100 m; that is
 * `100 / cssMetersPerSec` for display (see swimZonesLogic.ts).
 *
 * Pure and DB-free (no `server-only` import). DB glue: src/db/swimConfig.ts.
 *
 * Sources: Wakayoshi et al. (1992) and Ginn (1993) — CSS = (D2−D1)/(T2−T1), the
 * 400/200 protocol; Monod & Scherrer (1965) — the two-parameter critical-power
 * model the velocity-curve fit instantiates; Swim Smooth — CSS pace zones.
 */
import type { SwimZones, SwimZoneKey } from './types';
import {
  buildSwimZones,
  DEFAULT_SWIM_ZONES,
  type SwimZoneModel,
  type SwimZoneOverride,
} from './swimZonesLogic';

/** Pool course a raw time was swum in — provenance for the yards→meters fix (§6.3). */
export type PoolCourse = 'scm25' | 'lcm50' | 'scy25';

/** A raw swim test to derive CSS from (see `cssFromTest`). */
export interface SwimTest {
  kind: 'css_400_200' | 'css_two_distance' | 'time_trial' | 'velocity_curve';
  // css_400_200 (canonical Wakayoshi/Ginn):
  t400Sec?: number;
  t200Sec?: number;
  // css_two_distance (generic two-point critical velocity, e.g. Swim Smooth 400/50):
  dLongMeters?: number;
  tLongSec?: number;
  dShortMeters?: number;
  tShortSec?: number;
  // time_trial (single all-out effort → CSS via a duration-discount factor):
  ttDistanceMeters?: number;
  ttTimeSec?: number;
  // velocity_curve (≥2 distinct maximal efforts → least-squares critical velocity):
  curve?: Array<{ distanceMeters: number; timeSec: number }>;
  poolCourse?: PoolCourse; // provenance; see swim-foundation-spec.md §6.3
  date?: string;
}

/** One single-TT → CSS discount bucket: a TT no longer than `maxDurationSec`. */
export interface TtFactorBucket {
  maxDurationSec: number;
  /** TT speed ≈ CSS × factor; so CSS = ttSpeed / factor (short TT overshoots CSS). */
  factor: number;
}

/**
 * OVERALL swim model (the global default; coach tunes once). Sibling of
 * `GlobalPowerModel` / `GlobalPaceModel`. Persisted in `engine_settings.swimModel`.
 */
export interface GlobalSwimModel {
  zones: SwimZoneModel; // per-CSS pace-offset bands (sec/100 m)
  /**
   * Single-TT → CSS discount factors, sorted by ascending `maxDurationSec`
   * (the twin of the ramp/20-min multipliers). A ~100 m TT swims well above CSS
   * (factor > 1), a ~400 m TT ≈ CSS (≈1.0), a long 1500 m TT dips just below CSS.
   */
  ttFactorByDurationSec?: TtFactorBucket[];
}

export const DEFAULT_TT_FACTORS: TtFactorBucket[] = [
  { maxDurationSec: 90, factor: 1.12 }, // ~50–100 m sprint TT: well above CSS
  { maxDurationSec: 180, factor: 1.06 }, // ~100–200 m: above CSS
  { maxDurationSec: 420, factor: 1.0 }, // ~300–400 m: ≈ CSS (near-threshold)
  { maxDurationSec: 900, factor: 0.99 }, // ~800–1000 m: just below CSS
  { maxDurationSec: Number.POSITIVE_INFINITY, factor: 0.97 }, // 1500 m+: below CSS
];

export const DEFAULT_GLOBAL_SWIM_MODEL: GlobalSwimModel = {
  zones: DEFAULT_SWIM_ZONES,
  ttFactorByDurationSec: DEFAULT_TT_FACTORS,
};

/**
 * INDIVIDUAL athlete swim config; every field optional, layered on the global
 * model. The swim-side twin of `AthletePowerConfig` / `AthletePaceConfig`.
 */
export interface AthleteSwimConfig {
  // --- fitness anchor (provide one; resolution order in resolveCss) ---
  cssMetersPerSec?: number; // explicit CSS (wins)
  swimTest?: SwimTest; // a raw test to derive CSS from
  // --- provenance (identical semantics to paceConfig.anchorSource) ---
  anchorSource?: 'auto' | 'manual';
  // --- per-athlete overrides layered on the global model ---
  bandOverrides?: Partial<SwimZoneModel>; // custom per-CSS sec/100 offsets
  zoneOverrides?: Partial<Record<SwimZoneKey, SwimZoneOverride>>; // final sec/100 nudges
  // --- stroke/technique bias (the strengthBias analog) ---
  // + = fast/anaerobic (sprint-biased); − = diesel/aerobic (distance-biased).
  strengthBias?: number; // [-1, +1]
  // --- environment defaults (see swim-foundation-spec.md §6.1) ---
  defaultEnvironment?: 'pool' | 'open_water';
  openWaterOffsetSecPer100?: number; // learned/entered OW penalty
}

// --- CSS estimators (the `ftpFrom*` / `vdotFrom*` analogs) ------------------

/** Round a m/s value to a stable precision (thousandths — ~0.1 s/100 m). */
function roundMps(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Canonical Wakayoshi/Ginn 400/200 CSS: `(400 − 200) / (t400 − t200)`. The
 * two-point critical-velocity line whose slope is CSS. Highest confidence.
 * Returns null when the times are non-increasing (t400 must exceed t200).
 */
export function cssFrom400_200(t400Sec: number, t200Sec: number): number | null {
  const dt = t400Sec - t200Sec;
  if (!(dt > 0)) return null;
  return roundMps(200 / dt);
}

/**
 * Generic two-point critical velocity `(dL − dS) / (tL − tS)` — the Wakayoshi
 * fit for any two maximal efforts (supports the Swim Smooth 400/50 variant).
 * Returns null unless the longer swim is both farther and slower-elapsed.
 */
export function cssFromTwoDistance(
  dLongMeters: number,
  tLongSec: number,
  dShortMeters: number,
  tShortSec: number,
): number | null {
  const dd = dLongMeters - dShortMeters;
  const dt = tLongSec - tShortSec;
  if (!(dd > 0) || !(dt > 0)) return null;
  return roundMps(dd / dt);
}

/**
 * Least-squares critical velocity from ≥2 distinct maximal efforts: fit the
 * distance-linear form of the CP model `D = CV·T + d0` (D against T), the slope
 * `CV` being critical velocity. The direct swim twin of `criticalPowerFit`.
 * Returns null on fewer than two distinct distances (fit under-determined).
 */
export function cssFromVelocityCurve(
  curve: Array<{ distanceMeters: number; timeSec: number }>,
): number | null {
  const pts = curve.filter((p) => p.distanceMeters > 0 && p.timeSec > 0);
  const distinctD = new Set(pts.map((p) => p.distanceMeters));
  if (pts.length < 2 || distinctD.size < 2) return null;
  // x = T (time), y = D (distance). slope = CV, intercept = d0.
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const x = p.timeSec;
    const y = p.distanceMeters;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const cv = (n * sxy - sx * sy) / denom;
  if (!Number.isFinite(cv) || cv <= 0) return null;
  return roundMps(cv);
}

/** Pick the discount factor whose bucket covers a TT of `ttTimeSec`. */
export function ttFactorForDuration(ttTimeSec: number, factors: TtFactorBucket[] = DEFAULT_TT_FACTORS): number {
  for (const b of factors) {
    if (ttTimeSec <= b.maxDurationSec) return b.factor;
  }
  return factors.length ? factors[factors.length - 1].factor : 1;
}

/**
 * Single all-out time trial → CSS. The TT speed is discounted toward CSS by a
 * duration-dependent factor (short TT overshoots CSS, long TT ≈ CSS): CSS =
 * ttSpeed / factor. The lower-confidence twin of `ftpFromRamp`; flag for a
 * proper two-point retest. Returns null on non-positive distance/time.
 */
export function cssFromTimeTrial(
  ttDistanceMeters: number,
  ttTimeSec: number,
  factors: TtFactorBucket[] = DEFAULT_TT_FACTORS,
): number | null {
  if (!(ttDistanceMeters > 0) || !(ttTimeSec > 0)) return null;
  const speed = ttDistanceMeters / ttTimeSec;
  const factor = ttFactorForDuration(ttTimeSec, factors);
  if (!(factor > 0)) return null;
  return roundMps(speed / factor);
}

/** Dispatch a `SwimTest` to the right estimator using the global model. */
export function cssFromTest(
  test: SwimTest,
  global: GlobalSwimModel = DEFAULT_GLOBAL_SWIM_MODEL,
): number | null {
  const factors = global.ttFactorByDurationSec ?? DEFAULT_TT_FACTORS;
  switch (test.kind) {
    case 'css_400_200':
      return test.t400Sec != null && test.t200Sec != null
        ? cssFrom400_200(test.t400Sec, test.t200Sec)
        : null;
    case 'css_two_distance':
      return test.dLongMeters != null &&
        test.tLongSec != null &&
        test.dShortMeters != null &&
        test.tShortSec != null
        ? cssFromTwoDistance(test.dLongMeters, test.tLongSec, test.dShortMeters, test.tShortSec)
        : null;
    case 'time_trial':
      return test.ttDistanceMeters != null && test.ttTimeSec != null
        ? cssFromTimeTrial(test.ttDistanceMeters, test.ttTimeSec, factors)
        : null;
    case 'velocity_curve':
      return test.curve ? cssFromVelocityCurve(test.curve) : null;
    default: {
      const _exhaustive: never = test.kind;
      throw new Error(`cssFromTest: unknown test kind ${String(_exhaustive)}`);
    }
  }
}

/**
 * Resolve the single CSS anchor from config — the twin of `resolveFtp` /
 * `getAthleteVdot`. Precedence: explicit `cssMetersPerSec` → test-derived → null.
 * As on the pace/power side, the anchor is taken DIRECTLY from the fitness
 * signal, never re-derived from the (bias/override-carrying) training zones.
 * Null means "no CSS": the load rung falls back to `estimatedTss` (there is
 * deliberately NO swim HR fallback — swim-foundation-spec.md §4).
 */
export function resolveCss(
  config: AthleteSwimConfig,
  global: GlobalSwimModel = DEFAULT_GLOBAL_SWIM_MODEL,
): number | null {
  if (config.cssMetersPerSec != null) return config.cssMetersPerSec;
  if (config.swimTest) return cssFromTest(config.swimTest, global);
  return null;
}

/**
 * Resolve effective swim zones for an athlete = global swim model + their
 * swimConfig. The swim-side twin of `resolvePowerZones` / `resolvePaceZones`.
 * Unlike cycling there is NO HR fallback (swim HR is unreliable), so a missing
 * CSS anchor simply throws — prescribe by RPE until a test exists.
 */
export function resolveSwimZones(
  config: AthleteSwimConfig,
  global: GlobalSwimModel = DEFAULT_GLOBAL_SWIM_MODEL,
): SwimZones {
  const css = resolveCss(config, global);
  if (css == null) {
    throw new Error('resolveSwimZones: no fitness anchor (need cssMetersPerSec or swimTest)');
  }
  return buildSwimZones(css, {
    model: global.zones ?? DEFAULT_SWIM_ZONES,
    bandOverrides: config.bandOverrides,
    strengthBias: config.strengthBias,
    zoneOverrides: config.zoneOverrides,
  });
}
