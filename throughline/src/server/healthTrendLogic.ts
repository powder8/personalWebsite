/**
 * PURE health-trend logic (no DB) — one consistent read for every general
 * health signal: resting HR, HRV, sleep, weight, daily steps.
 *
 * Each metric is judged against the athlete's OWN recent baseline, never an
 * absolute threshold: the last 7 days versus the 28 days before that. The
 * direction accounts for what "better" means per metric — a falling resting HR
 * is good, a falling HRV is not, and weight is reported without judgement (a
 * drop can be intended or under-fuelling; the coach comments, the number stays
 * neutral).
 *
 * Health, not training: none of this feeds the training-load model.
 */

export type HealthMetric = 'resting_hr' | 'hrv' | 'sleep' | 'weight' | 'steps';
export type Polarity = 'lower_better' | 'higher_better' | 'neutral';
export type TrendDirection = 'improving' | 'worsening' | 'up' | 'down' | 'steady' | 'unknown';

export interface DailySample {
  day: string;
  value: number;
}

export interface HealthTrend {
  metric: HealthMetric;
  polarity: Polarity;
  /** Mean of the last 7 days with data. */
  current: number | null;
  /** Mean of the 28 days before that (the baseline). */
  baseline: number | null;
  /** Signed % change current vs baseline (raw, in the metric's own direction). */
  deltaPct: number | null;
  direction: TrendDirection;
  /** Weekly medians, oldest → newest, for a sparkline (null = no data that week). */
  weekly: (number | null)[];
  days: number; // samples in the whole window
  latest: DailySample | null;
}

export const POLARITY: Record<HealthMetric, Polarity> = {
  resting_hr: 'lower_better',
  hrv: 'higher_better',
  sleep: 'higher_better',
  weight: 'neutral',
  steps: 'higher_better',
};

/** Below this the week-over-week change is noise, not a trend. */
const STEADY_PCT: Record<HealthMetric, number> = {
  resting_hr: 3, // a couple of bpm on ~50 is ~4%
  hrv: 8, // HRV is noisy day to day
  sleep: 5,
  weight: 1, // 1% of body mass is ~0.7 kg, the smallest meaningful move
  steps: 10,
};

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function buildHealthTrend(
  metric: HealthMetric,
  samples: DailySample[],
  opts: { today: string; weeks?: number },
): HealthTrend {
  const weeks = opts.weeks ?? 12;
  const polarity = POLARITY[metric];
  const windowStart = addDays(opts.today, -(weeks * 7) + 1);
  const clean = samples
    .filter((s) => Number.isFinite(s.value) && s.value > 0 && s.day >= windowStart && s.day <= opts.today)
    .sort((a, b) => a.day.localeCompare(b.day));

  const recentStart = addDays(opts.today, -6); // last 7 days incl. today
  const baseStart = addDays(opts.today, -34); // the 28 days before those
  const current = mean(clean.filter((s) => s.day >= recentStart).map((s) => s.value));
  const baseline = mean(clean.filter((s) => s.day >= baseStart && s.day < recentStart).map((s) => s.value));

  let deltaPct: number | null = null;
  let direction: TrendDirection = 'unknown';
  if (current != null && baseline != null && baseline > 0) {
    deltaPct = Math.round(((current - baseline) / baseline) * 1000) / 10;
    if (Math.abs(deltaPct) < STEADY_PCT[metric]) direction = 'steady';
    else if (polarity === 'neutral') direction = deltaPct > 0 ? 'up' : 'down';
    else {
      const better = polarity === 'higher_better' ? deltaPct > 0 : deltaPct < 0;
      direction = better ? 'improving' : 'worsening';
    }
  }

  // Weekly medians for the sparkline, oldest → newest, ending with today's week.
  const weekly: (number | null)[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = addDays(opts.today, -7 * w);
    const start = addDays(end, -6);
    weekly.push(median(clean.filter((s) => s.day >= start && s.day <= end).map((s) => s.value)));
  }

  return {
    metric,
    polarity,
    current: current != null ? Math.round(current * 10) / 10 : null,
    baseline: baseline != null ? Math.round(baseline * 10) / 10 : null,
    deltaPct,
    direction,
    weekly,
    days: clean.length,
    latest: clean.at(-1) ?? null,
  };
}
