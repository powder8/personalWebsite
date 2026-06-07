/**
 * Training load (impulse) for a session.
 *
 * Preferred: Banister TRIMP from heart rate, which captures intensity, not just
 * volume. Falls back to a coarse volume-based estimate when HR is missing — the
 * result is flagged `estimated` so downstream logic (and the coach) knows not to
 * over-trust it.
 */
import type { HrParams } from './types';

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export interface LoadResult {
  load: number;
  estimated: boolean; // true when HR was unavailable and we fell back to volume
}

/**
 * Banister TRIMP:
 *   TRIMP = duration_min * HRr * a * e^(b * HRr)
 * where HRr is the fraction of heart-rate reserve, and (a,b) are sex-specific
 * weighting constants (men 0.64/1.92, women 0.86/1.67) that bias load toward
 * higher intensities.
 */
export function banisterTrimp(
  durationSeconds: number,
  avgHr: number,
  hr: HrParams,
): number {
  const durMin = durationSeconds / 60;
  const reserve = hr.maxHr - hr.restingHr;
  if (reserve <= 0) return 0;
  const hrr = clamp((avgHr - hr.restingHr) / reserve, 0, 1);
  const a = hr.sex === 'F' ? 0.86 : 0.64;
  const b = hr.sex === 'F' ? 1.67 : 1.92;
  return durMin * hrr * a * Math.exp(b * hrr);
}

export interface SessionForLoad {
  durationSeconds: number;
  avgHr?: number | null;
  distanceMeters?: number | null;
}

/**
 * Best-available load for a session. Uses Banister TRIMP when HR is present;
 * otherwise a rough volume proxy (~ duration scaled), flagged as estimated.
 */
export function estimateLoad(session: SessionForLoad, hr?: HrParams | null): LoadResult {
  if (session.avgHr != null && hr) {
    return { load: banisterTrimp(session.durationSeconds, session.avgHr, hr), estimated: false };
  }
  // Volume fallback: minutes at an assumed moderate intensity. Deliberately
  // simple — better signal requires HR.
  const durMin = session.durationSeconds / 60;
  return { load: durMin * 0.7, estimated: true };
}
