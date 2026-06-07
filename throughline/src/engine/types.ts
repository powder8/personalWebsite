/**
 * Engine types. The engine is pure: it takes plain readings + params and emits
 * structured, explainable results. No DB, no I/O, no clock.
 */

export type PhysioSignal = 'hrv' | 'resting_hr' | 'sleep';

/** A single dated numeric reading of one signal (or daily training load). */
export interface DailyReading {
  day: string; // 'YYYY-MM-DD'
  value: number;
}

/** Rolling baseline for one signal, as of one day. */
export interface BaselineStats {
  shortMean: number | null; // 7d window
  shortStd: number | null;
  longMean: number | null; // 60d window
  longStd: number | null;
  latestValue: number | null;
  latestZ: number | null; // (latest - longMean) / longStd; null if insufficient data
  n: number; // sample count in the long window
}

/** Banister fitness/fatigue state for one day. */
export interface FitnessFatiguePoint {
  day: string;
  load: number; // training load applied that day
  ctl: number; // chronic training load (fitness)
  atl: number; // acute training load (fatigue)
  tsb: number; // training stress balance / form (ctl - atl)
}

/** Heart-rate parameters needed for a Banister TRIMP load estimate. */
export interface HrParams {
  restingHr: number;
  maxHr: number;
  sex?: 'M' | 'F';
}

// --- Readiness ---

export type DriverKey =
  | 'hrv'
  | 'resting_hr'
  | 'sleep'
  | 'soreness'
  | 'energy'
  | 'yesterday_rpe';

export interface ReadinessInput {
  day: string;
  hrvZ: number | null;
  restingHrZ: number | null; // higher = worse (handled by the engine)
  sleepZ: number | null;
  soreness: number | null; // 0-10 subjective
  energy: number | null; // 0-10 subjective
  yesterdayRpe: number | null; // 0-10
  /** Optional trend context for a more defensible sentence. */
  hrvDaysSuppressed?: number;
}

export interface EngineParams {
  /** 0..1; higher errs toward caution (easy). 0.5 = neutral. */
  conservatism: number;
  /** Per-signal trust weights. Missing = default 1 (or per-signal default). */
  weights: Partial<Record<DriverKey, number>>;
}

export type ReadinessBand = 'easy' | 'normal' | 'go';

export interface ReadinessDriver {
  key: DriverKey;
  /** The signed contribution to the score, in [-1, 1] (after weighting). */
  contribution: number;
  /** Raw input that produced it (z-score or 0-10 value), for explainability. */
  value: number;
  note: string;
}

export interface ReadinessResult {
  day: string;
  score: number; // 0-100, interpretable
  band: ReadinessBand;
  sentence: string; // one defensible sentence, generated deterministically
  drivers: ReadinessDriver[]; // sorted by |contribution| desc
  sufficientData: boolean;
}
