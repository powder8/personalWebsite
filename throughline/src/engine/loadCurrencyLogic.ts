/**
 * Load-currency kernel — the unified TSS-equivalent training load (spec story L0).
 *
 * PURE (no `server-only`, no DB, no clock): the interchangeable "rungs of one
 * ladder", where every sport produces the SAME number the SAME way:
 *
 *     Load (TSS-equivalent) = IF² × durationHours × 100
 *
 * `IF` (intensity factor) is the session's threshold-relative intensity for that
 * sport. By construction 100 = one hour at threshold — in run, bike, and swim
 * alike — so daily loads from different sports are directly comparable and
 * summable onto one PMC. This is Coggan's TSS generalized: his canonical
 * `TSS = (sec × NP × IF)/(FTP × 3600) × 100` equals `IF² × hours × 100` because
 * `NP/FTP = IF` (Allen, Coggan & McGregor, 3rd ed., ch. 7).
 *
 * The four rungs (+ a fallback) all return the SAME {@link LoadCurrencyResult}
 * shape, so they're interchangeable and each carries a `confidence` tier:
 *   power (TSS) > pace (rTSS) > css (sTSS) > hr (hrTSS) > estimated (zone/duration).
 *
 * NON-DESTRUCTIVE: nothing here is wired into what the app reads today. The live
 * PMC keeps using Banister TRIMP (`engine/load.ts` + `server/fitness.ts`) until
 * the later, owner-signed-off cutover. See
 * docs/multisport/load-currency-transfer-spec.md (§1.2–§1.4).
 */
import { banisterTrimp } from './load';
import type { HrParams } from './types';

// ---------------------------------------------------------------------------
// Shape + constants
// ---------------------------------------------------------------------------

/**
 * Confidence tier of a computed load, ordered strongest→weakest. Persisted so
 * the coach UI and the (future) triathlon allocator can discount soft currency.
 */
export type LoadConfidence = 'power' | 'pace' | 'css' | 'hr' | 'estimated';

/** The common output of every rung — same shape, so they're interchangeable. */
export interface LoadCurrencyResult {
  /** TSS-equivalent load = IF² × hours × 100. */
  load: number;
  /** The threshold-relative intensity factor used. */
  intensityFactor: number;
  /** Session duration in hours (the `h` in the kernel). */
  durationHours: number;
  /** Provenance / trust tier of this number. */
  confidence: LoadConfidence;
  /**
   * True when the currency is soft: the zone/duration fallback, or neuromuscular
   * sprint work that this aerobic-metabolic kernel under-weights (spec §1.2 note).
   */
  lowConfidence: boolean;
}

/** The kernel anchor: IF=1 for one hour → 100. */
export const THRESHOLD_HOUR_LOAD = 100;

/**
 * HR-reserve fraction at threshold, used to synthesize a threshold-HR when the
 * athlete's LTHR is unknown (spec §2.3: at threshold HRr ≈ 0.85–0.90). The
 * worked example (men, a=0.64/b=1.92) gives ≈177 TRIMP for a threshold hour.
 */
export const DEFAULT_THRESHOLD_HRR = 0.87;

/** Ceiling on run IF, so short reps don't inflate rTSS (spec §1.3b). */
export const MAX_RUN_IF = 1.15;
/** Ceiling on swim IF, per spec §1.3c. */
export const MAX_SWIM_IF = 1.1;

/**
 * Conservative endurance IF for a completed activity with only duration
 * (spec §1.3e): 0.65² × 100 ≈ 42/h — chosen to match the legacy volume proxy
 * (`durMin × 0.7` = 42/h) so HR-free athletes barely renumber on cutover.
 */
export const DEFAULT_ESTIMATED_IF = 0.65;

/**
 * Nominal IF per training zone (spec §1.3e; cycling-spec §4.2). Used for planned
 * sessions (which have no HR yet) and as the zone-based fallback IF.
 */
export const ZONE_IF: Readonly<Record<string, number>> = {
  recovery: 0.55,
  easy: 0.65,
  endurance: 0.65,
  maintenance: 0.7,
  marathon: 0.78,
  tempo: 0.82,
  sweetspot: 0.9,
  threshold: 0.98,
  intervals: 1.05,
  vo2max: 1.05,
  rep: 1.1,
};

/** Nominal IF for a named zone; falls back to the endurance default. */
export function zoneIf(zone: string): number {
  return ZONE_IF[zone.toLowerCase()] ?? DEFAULT_ESTIMATED_IF;
}

// ---------------------------------------------------------------------------
// The shared kernel
// ---------------------------------------------------------------------------

/** The one identity every rung uses: Load = IF² × hours × 100. */
export function loadFromIntensity(intensityFactor: number, durationHours: number): number {
  if (!(durationHours > 0) || !(intensityFactor > 0)) return 0;
  return intensityFactor * intensityFactor * durationHours * THRESHOLD_HOUR_LOAD;
}

// ---------------------------------------------------------------------------
// (a) Cycling — TSS from power
// ---------------------------------------------------------------------------

/**
 * Normalized Power (Allen & Coggan): a 30-second rolling average of power, each
 * value raised to the 4th power, averaged, then 4th-rooted. The 30 s window +
 * quartic model the quasi-quartic power↔physiological-cost relationship, so
 * variable rides cost more than their simple average. `sampleIntervalSec` is the
 * spacing of the samples (default 1 s). Streams shorter than one full 30 s
 * window fall back to the simple mean.
 */
export function normalizedPower(powerSamples: number[], sampleIntervalSec = 1): number {
  const n = powerSamples.length;
  if (n === 0) return 0;
  const windowSamples = Math.max(1, Math.round(30 / sampleIntervalSec));
  if (n < windowSamples) {
    return powerSamples.reduce((a, b) => a + b, 0) / n; // shorter than a window
  }
  const rolled: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += powerSamples[i];
    if (i >= windowSamples) sum -= powerSamples[i - windowSamples];
    if (i >= windowSamples - 1) rolled.push(sum / windowSamples); // first full window onward
  }
  const mean4 = rolled.reduce((acc, p) => acc + p ** 4, 0) / rolled.length;
  return mean4 ** 0.25;
}

export interface PowerSession {
  ftpWatts: number;
  durationSeconds: number;
  /** Raw power stream (preferred — NP is computed from it). */
  powerSamples?: number[];
  sampleIntervalSec?: number;
  /** Pre-computed Normalized Power, when the raw stream isn't available. */
  normalizedPowerWatts?: number;
}

/**
 * Cycling TSS from power. IF = NP / FTP; TSS = IF² × hours × 100. FTP is the
 * fitness anchor (`db/powerConfig.ts:getAthleteFtp`), never re-derived from zones.
 */
export function tssFromPower(s: PowerSession): LoadCurrencyResult {
  const np =
    s.normalizedPowerWatts ??
    (s.powerSamples && s.powerSamples.length ? normalizedPower(s.powerSamples, s.sampleIntervalSec ?? 1) : 0);
  const durationHours = s.durationSeconds / 3600;
  const intensityFactor = s.ftpWatts > 0 ? np / s.ftpWatts : 0;
  return {
    load: loadFromIntensity(intensityFactor, durationHours),
    intensityFactor,
    durationHours,
    confidence: 'power',
    lowConfidence: false,
  };
}

// ---------------------------------------------------------------------------
// (b) Running — rTSS from pace / GAP / NGP
// ---------------------------------------------------------------------------

export interface RunSession {
  /** Threshold ("T") pace in sec/km, from the VDOT anchor. */
  thresholdPaceSecPerKm: number;
  durationSeconds: number;
  /** Normalized Graded Pace (preferred — variability-weighted GAP). */
  ngpSecPerKm?: number;
  /** Grade-adjusted average pace (see engine/plan/gap.ts). */
  gapSecPerKm?: number;
  /** Raw average pace — last resort within the pace tier. */
  avgPaceSecPerKm?: number;
  /** IF ceiling for short reps (default {@link MAX_RUN_IF}). */
  maxIf?: number;
}

/**
 * Running rTSS. Works in SPEED so faster→higher IF: IF = thresholdSpeed⁻¹ ratio =
 * `T / pace` (T and pace both sec/km). Prefers NGP → GAP → raw pace. Clamped to a
 * sane ceiling for short reps. TrainingPeaks rTSS/NGP methodology; GAP from
 * Minetti et al. (2002).
 */
export function rtss(s: RunSession): LoadCurrencyResult {
  const pace = s.ngpSecPerKm ?? s.gapSecPerKm ?? s.avgPaceSecPerKm ?? 0;
  const durationHours = s.durationSeconds / 3600;
  let intensityFactor = pace > 0 && s.thresholdPaceSecPerKm > 0 ? s.thresholdPaceSecPerKm / pace : 0;
  const cap = s.maxIf ?? MAX_RUN_IF;
  if (intensityFactor > cap) intensityFactor = cap;
  return {
    load: loadFromIntensity(intensityFactor, durationHours),
    intensityFactor,
    durationHours,
    confidence: 'pace',
    lowConfidence: false,
  };
}

// ---------------------------------------------------------------------------
// (c) Swimming — sTSS from CSS
// ---------------------------------------------------------------------------

export interface SwimSession {
  /** Critical Swim Speed in m/s (the swim threshold; Wakayoshi et al. 1992). */
  cssMetersPerSec: number;
  durationSeconds: number;
  /** Average swim speed in m/s (preferred). */
  swimSpeedMetersPerSec?: number;
  /** Distance in m — with duration, yields average speed. */
  distanceMeters?: number;
  /** IF ceiling (default {@link MAX_SWIM_IF}). */
  maxIf?: number;
}

/** Swimming sTSS. IF = swimSpeed / CSS; sTSS = IF² × hours × 100. */
export function stss(s: SwimSession): LoadCurrencyResult {
  const speed =
    s.swimSpeedMetersPerSec ??
    (s.distanceMeters != null && s.durationSeconds > 0 ? s.distanceMeters / s.durationSeconds : 0);
  const durationHours = s.durationSeconds / 3600;
  let intensityFactor = s.cssMetersPerSec > 0 ? speed / s.cssMetersPerSec : 0;
  const cap = s.maxIf ?? MAX_SWIM_IF;
  if (intensityFactor > cap) intensityFactor = cap;
  return {
    load: loadFromIntensity(intensityFactor, durationHours),
    intensityFactor,
    durationHours,
    confidence: 'css',
    lowConfidence: false,
  };
}

// ---------------------------------------------------------------------------
// (d) Any sport, HR present but no power/pace quality — hrTSS (fallback)
// ---------------------------------------------------------------------------

/**
 * TRIMP for one hour at threshold HR — the conversion constant that maps existing
 * Banister TRIMP onto the TSS axis (spec §2.3; also drives the backfill). Uses the
 * athlete's LTHR when known, else threshold-HR = resting + {@link DEFAULT_THRESHOLD_HRR}
 * × HR-reserve.
 */
export function thresholdHourTrimp(hr: HrParams, lthrBpm?: number | null): number {
  const thresholdHr =
    lthrBpm != null ? lthrBpm : hr.restingHr + DEFAULT_THRESHOLD_HRR * (hr.maxHr - hr.restingHr);
  return banisterTrimp(3600, thresholdHr, hr);
}

export interface HrSession {
  durationSeconds: number;
  avgHr: number;
  hr: HrParams;
  lthrBpm?: number | null;
  /** Pre-computed session TRIMP, if the caller already has it (else derived). */
  trimp?: number;
}

/**
 * hrTSS: reuse Banister TRIMP verbatim (sport-agnostic) and rescale so a
 * threshold-HR hour = 100 — `hrTSS = TRIMP(session) / TRIMP(1h @ threshold-HR) × 100`.
 * Flagged `hr` confidence: HR lags/saturates (cardiac drift inflates late load,
 * under-reads short intervals).
 */
export function hrTss(s: HrSession): LoadCurrencyResult {
  const durationHours = s.durationSeconds / 3600;
  const sessionTrimp = s.trimp ?? banisterTrimp(s.durationSeconds, s.avgHr, s.hr);
  const anchor = thresholdHourTrimp(s.hr, s.lthrBpm);
  const load = anchor > 0 ? (sessionTrimp / anchor) * THRESHOLD_HOUR_LOAD : 0;
  // Recover the implied IF for reporting: load = IF²·h·100 → IF = √(load / (h·100)).
  const intensityFactor = durationHours > 0 ? Math.sqrt(load / (durationHours * THRESHOLD_HOUR_LOAD)) : 0;
  return { load, intensityFactor, durationHours, confidence: 'hr', lowConfidence: false };
}

// ---------------------------------------------------------------------------
// (e) No quality data — estimated TSS from duration × assigned IF
// ---------------------------------------------------------------------------

export interface EstimatedSession {
  durationSeconds: number;
  /** Explicit assumed IF (wins). */
  assumedIf?: number;
  /** Or a zone whose nominal IF is used (see {@link zoneIf}). */
  zone?: string;
}

/**
 * Estimated TSS for a session with no quality signal. Uses an explicit assumed
 * IF, else the zone's nominal IF, else the conservative endurance default.
 * Always `estimated` confidence + lowConfidence.
 */
export function estimatedTss(s: EstimatedSession): LoadCurrencyResult {
  const durationHours = s.durationSeconds / 3600;
  const intensityFactor =
    s.assumedIf != null ? s.assumedIf : s.zone ? zoneIf(s.zone) : DEFAULT_ESTIMATED_IF;
  return {
    load: loadFromIntensity(intensityFactor, durationHours),
    intensityFactor,
    durationHours,
    confidence: 'estimated',
    lowConfidence: true,
  };
}

// ---------------------------------------------------------------------------
// Dispatch — the sport-switch layered on the rungs (spec §1.4)
// ---------------------------------------------------------------------------

/** Per-athlete fitness anchors, resolved from paceConfig / powerConfig / (future) swimConfig. */
export interface LoadAnchors {
  ftpWatts?: number | null;
  thresholdPaceSecPerKm?: number | null;
  cssMetersPerSec?: number | null;
  lthrBpm?: number | null;
  hr?: HrParams | null;
}

/** The completed-activity fields the dispatcher can read. */
export interface ActivityForLoad {
  sport: 'run' | 'bike' | 'swim' | 'strength' | 'cross_train' | 'other';
  durationSeconds: number;
  avgHr?: number | null;
  distanceMeters?: number | null;
  avgPaceSecPerKm?: number | null;
  gapSecPerKm?: number | null;
  ngpSecPerKm?: number | null;
  normalizedPowerWatts?: number | null;
  powerSamples?: number[] | null;
  swimSpeedMetersPerSec?: number | null;
  zone?: string | null;
}

/**
 * Best-available TSS-equivalent load for a completed activity, dispatched by
 * sport down the confidence ladder (spec §1.4):
 *
 *   bike:  power? tssFromPower : hr? hrTSS : estimatedTss
 *   run:   pace?  rtss         : hr? hrTSS : estimatedTss
 *   swim:  css?   stss         :           estimatedTss   (swim HR unreliable)
 *   other: hr? hrTSS(lowConf)  :           estimatedTss   (always low confidence)
 */
export function estimateLoadTss(a: ActivityForLoad, anchors: LoadAnchors = {}): LoadCurrencyResult {
  const dur = a.durationSeconds;
  if (!(dur > 0)) {
    return { load: 0, intensityFactor: 0, durationHours: 0, confidence: 'estimated', lowConfidence: true };
  }
  const hasHr = a.avgHr != null && anchors.hr != null;

  switch (a.sport) {
    case 'bike': {
      const hasPower =
        anchors.ftpWatts != null &&
        (a.normalizedPowerWatts != null || (a.powerSamples != null && a.powerSamples.length > 0));
      if (hasPower) {
        return tssFromPower({
          ftpWatts: anchors.ftpWatts!,
          durationSeconds: dur,
          normalizedPowerWatts: a.normalizedPowerWatts ?? undefined,
          powerSamples: a.powerSamples ?? undefined,
        });
      }
      if (hasHr) {
        return hrTss({ durationSeconds: dur, avgHr: a.avgHr!, hr: anchors.hr!, lthrBpm: anchors.lthrBpm });
      }
      return estimatedTss({ durationSeconds: dur, zone: a.zone ?? undefined });
    }

    case 'run': {
      const pace = a.ngpSecPerKm ?? a.gapSecPerKm ?? a.avgPaceSecPerKm ?? null;
      if (anchors.thresholdPaceSecPerKm != null && pace != null && pace > 0) {
        return rtss({
          thresholdPaceSecPerKm: anchors.thresholdPaceSecPerKm,
          durationSeconds: dur,
          ngpSecPerKm: a.ngpSecPerKm ?? undefined,
          gapSecPerKm: a.gapSecPerKm ?? undefined,
          avgPaceSecPerKm: a.avgPaceSecPerKm ?? undefined,
        });
      }
      if (hasHr) {
        return hrTss({ durationSeconds: dur, avgHr: a.avgHr!, hr: anchors.hr!, lthrBpm: anchors.lthrBpm });
      }
      return estimatedTss({ durationSeconds: dur, zone: a.zone ?? undefined });
    }

    case 'swim': {
      const speed =
        a.swimSpeedMetersPerSec ??
        (a.distanceMeters != null && dur > 0 ? a.distanceMeters / dur : null);
      if (anchors.cssMetersPerSec != null && speed != null && speed > 0) {
        return stss({ cssMetersPerSec: anchors.cssMetersPerSec, durationSeconds: dur, swimSpeedMetersPerSec: speed });
      }
      // Swim HR is unreliable — go straight to the estimated fallback.
      return estimatedTss({ durationSeconds: dur, zone: a.zone ?? undefined });
    }

    default: {
      // strength / cross_train / other: zone/duration fallback, always soft. If HR
      // exists we rescale it, but still flag lowConfidence (this kernel under-reads
      // strength/neuromuscular work — spec §1.2 note).
      if (hasHr) {
        const r = hrTss({ durationSeconds: dur, avgHr: a.avgHr!, hr: anchors.hr!, lthrBpm: anchors.lthrBpm });
        return { ...r, lowConfidence: true };
      }
      return estimatedTss({ durationSeconds: dur, zone: a.zone ?? undefined });
    }
  }
}
