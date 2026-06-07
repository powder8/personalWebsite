/**
 * Per-signal personal baselines. Readings are interpreted ONLY as z-scores vs
 * the athlete's own rolling baseline — never against absolute thresholds (spec,
 * Phase 2). Short window = 7d, long window = 60d.
 */
import type { DailyReading, BaselineStats } from './types';
import { dayNumber } from './dates';

export interface BaselineOptions {
  shortDays: number;
  longDays: number;
}

export const DEFAULT_BASELINE_OPTIONS: BaselineOptions = { shortDays: 7, longDays: 60 };

function meanStd(values: number[]): { mean: number | null; std: number | null } {
  if (values.length === 0) return { mean: null, std: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, std: null };
  // Sample standard deviation (n-1).
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

/** Values within the trailing `windowDays` ending on (and including) `asOf`. */
export function windowValues(
  readings: DailyReading[],
  asOf: string,
  windowDays: number,
): number[] {
  const end = dayNumber(asOf);
  const start = end - windowDays + 1;
  return readings
    .filter((r) => {
      const dn = dayNumber(r.day);
      return dn >= start && dn <= end;
    })
    .map((r) => r.value);
}

/** Most recent reading on or before `asOf`, or null. */
function latestOnOrBefore(readings: DailyReading[], asOf: string): number | null {
  const end = dayNumber(asOf);
  let best: { dn: number; value: number } | null = null;
  for (const r of readings) {
    const dn = dayNumber(r.day);
    if (dn <= end && (!best || dn > best.dn)) best = { dn, value: r.value };
  }
  return best?.value ?? null;
}

export function computeBaseline(
  readings: DailyReading[],
  asOf: string,
  opts: BaselineOptions = DEFAULT_BASELINE_OPTIONS,
): BaselineStats {
  const shortVals = windowValues(readings, asOf, opts.shortDays);
  const longVals = windowValues(readings, asOf, opts.longDays);
  const short = meanStd(shortVals);
  const long = meanStd(longVals);
  const latestValue = latestOnOrBefore(readings, asOf);

  const latestZ =
    latestValue != null && long.mean != null && long.std != null && long.std > 0
      ? (latestValue - long.mean) / long.std
      : null;

  return {
    shortMean: short.mean,
    shortStd: short.std,
    longMean: long.mean,
    longStd: long.std,
    latestValue,
    latestZ,
    n: longVals.length,
  };
}
