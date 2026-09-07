/**
 * PURE per-sport fitness-progress logic (no DB).
 *
 * "Am I getting fitter at THIS sport?" needs a performance number, not training
 * load (CTL says how much you trained, not how fast you are). What's derivable
 * differs by sport, because the data differs:
 *
 *   • run   → VDOT from race-able efforts. The gold standard, and VDOT is a
 *             performance-derived VO2max proxy, so it doubles as the VO2max read.
 *   • bike  → EFFICIENCY (metres per heartbeat). We store no power, so FTP cannot
 *             be derived from rides; speed-at-HR is the honest proxy.
 *   • swim  → pace per 100 m on quality swims (lower is better).
 *
 * Efficiency is the cross-sport twin of "how does this compare with similar
 * previous workouts": dividing speed by heart rate normalises for the day, the
 * terrain and the effort, so two easy sessions weeks apart are comparable.
 *
 * Single readings are noisy (wind, hills, heat, drafting), so samples are
 * bucketed into periods and aggregated — a ceiling for VDOT (fitness is what you
 * can do on a good day), a median for efficiency/pace (typical, not lucky).
 */

export type ProgressMetric = 'vdot' | 'efficiency' | 'swim_pace';
export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

/** One activity-derived reading. */
export interface ProgressSample {
  day: string; // YYYY-MM-DD
  value: number;
}

export interface ProgressBucket {
  /** First day of the period (YYYY-MM-DD). */
  start: string;
  /** Aggregated value, or null when nothing qualified in the period. */
  value: number | null;
  samples: number;
}

export interface SportProgress {
  metric: ProgressMetric;
  buckets: ProgressBucket[];
  /** Most recent period with data. */
  current: number | null;
  /** Earliest period with data — the baseline `current` is compared against. */
  baseline: number | null;
  /** Signed % change from baseline → current, in the metric's own direction. */
  deltaPct: number | null;
  /** Improving / declining / flat, already accounting for lower-is-better metrics. */
  direction: TrendDirection;
  /** Total qualifying readings across the window. */
  samples: number;
}

/** Lower is better for swim pace (sec/100m); higher is better for the rest. */
export function higherIsBetter(metric: ProgressMetric): boolean {
  return metric !== 'swim_pace';
}

/** A ceiling metric takes the best in a period; the rest take the median. */
function aggregate(metric: ProgressMetric, values: number[]): number {
  if (metric === 'vdot') return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A change smaller than this is noise, not a trend. */
const FLAT_PCT = 1.5;

/**
 * Bucket samples into `periods` windows of `periodDays` ending today, aggregate
 * each, and summarise the trend from the earliest populated period to the latest.
 */
export function buildSportProgress(
  samples: ProgressSample[],
  opts: { today: string; metric: ProgressMetric; periodDays?: number; periods?: number },
): SportProgress {
  const { today, metric } = opts;
  const periodDays = opts.periodDays ?? 28;
  const periods = opts.periods ?? 6;

  // Oldest → newest. The last bucket ends today (inclusive).
  const starts: string[] = [];
  for (let i = periods - 1; i >= 0; i--) starts.push(addDays(today, -(periodDays * i) - (periodDays - 1)));

  const grouped: number[][] = starts.map(() => []);
  let total = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.value) || s.value <= 0) continue;
    if (s.day > today) continue;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (s.day >= starts[i]) {
        grouped[i].push(s.value);
        total++;
        break;
      }
    }
  }

  const buckets: ProgressBucket[] = starts.map((start, i) => ({
    start,
    value: grouped[i].length ? aggregate(metric, grouped[i]) : null,
    samples: grouped[i].length,
  }));

  const populated = buckets.filter((b) => b.value != null);
  const current = populated.length ? populated[populated.length - 1].value! : null;
  // Need two DIFFERENT periods to claim a trend at all.
  const baseline = populated.length > 1 ? populated[0].value! : null;

  let deltaPct: number | null = null;
  let direction: TrendDirection = 'unknown';
  if (current != null && baseline != null && baseline > 0) {
    const raw = ((current - baseline) / baseline) * 100;
    // Report the change in the metric's own "better" direction, so a falling
    // swim pace reads as a positive (improving) delta.
    deltaPct = Math.round((higherIsBetter(metric) ? raw : -raw) * 10) / 10;
    direction = Math.abs(deltaPct) < FLAT_PCT ? 'flat' : deltaPct > 0 ? 'up' : 'down';
  }

  return { metric, buckets, current, baseline, deltaPct, direction, samples: total };
}

/**
 * Metres travelled per heartbeat — speed normalised by heart rate. The honest
 * cross-sport "are similar sessions getting easier?" number when there's no
 * power meter. Null unless the session has real distance, duration and HR.
 */
export function metresPerBeat(a: {
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgHr: number | null;
}): number | null {
  const { distanceMeters: d, durationSeconds: s, avgHr: hr } = a;
  if (!d || !s || !hr) return null;
  if (d <= 0 || s <= 0 || hr <= 0) return null;
  const beats = hr * (s / 60);
  if (beats <= 0) return null;
  return d / beats;
}
