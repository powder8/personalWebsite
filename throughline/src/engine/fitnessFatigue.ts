/**
 * Banister-style impulse–response fitness/fatigue.
 *
 * CTL (chronic / fitness) and ATL (acute / fatigue) are exponentially-weighted
 * moving averages of daily training load with long (≈42d) and short (≈7d) time
 * constants. TSB (form) = CTL − ATL. Missing days count as zero load, so rest
 * decays both curves correctly.
 *
 *   X_today = X_yesterday + (load_today − X_yesterday) * (1 − e^(−1/tau))
 */
import type { DailyReading, FitnessFatiguePoint } from './types';
import { dayRange, dayNumber } from './dates';

export interface FitnessFatigueOptions {
  ctlTau: number; // days
  atlTau: number; // days
  /** Seed values for the day before the series starts. */
  ctl0: number;
  atl0: number;
}

export const DEFAULT_FF_OPTIONS: FitnessFatigueOptions = {
  ctlTau: 42,
  atlTau: 7,
  ctl0: 0,
  atl0: 0,
};

/**
 * Compute the daily CTL/ATL/TSB series over [from, to] inclusive. `dailyLoads`
 * may have gaps and need not be sorted; absent days are treated as zero load.
 */
export function computeFitnessFatigue(
  dailyLoads: DailyReading[],
  from: string,
  to: string,
  opts: FitnessFatigueOptions = DEFAULT_FF_OPTIONS,
): FitnessFatiguePoint[] {
  const loadByDay = new Map<number, number>();
  for (const r of dailyLoads) {
    loadByDay.set(dayNumber(r.day), (loadByDay.get(dayNumber(r.day)) ?? 0) + r.value);
  }

  const ctlAlpha = 1 - Math.exp(-1 / opts.ctlTau);
  const atlAlpha = 1 - Math.exp(-1 / opts.atlTau);

  let ctl = opts.ctl0;
  let atl = opts.atl0;
  const out: FitnessFatiguePoint[] = [];

  for (const day of dayRange(from, to)) {
    const load = loadByDay.get(dayNumber(day)) ?? 0;
    ctl = ctl + (load - ctl) * ctlAlpha;
    atl = atl + (load - atl) * atlAlpha;
    out.push({ day, load, ctl, atl, tsb: ctl - atl });
  }
  return out;
}
