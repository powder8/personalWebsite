/**
 * Goal-progress trend (PURE). Turns the athlete's fitness series (CTL — the
 * chronic training load that actually drives the projected finish) into a quick
 * "are you trending the right way?" read for the goal card. CTL here is the
 * multisport CENTRAL track, so a triathlete building on the bike still shows
 * fitness climbing.
 *
 * This is the honest visual answer to "am I on track for a stretch goal?": for a
 * season goal the lever is whether fitness is CLIMBING, so the trend of the input
 * to the projection is the truthful thing to show — no fabricated finish history.
 */
export interface CtlPoint {
  day: string;
  ctl: number;
}

export type ProgressDirection = 'climbing' | 'holding' | 'declining';

export interface GoalProgress {
  /** Weekly-sampled points for the sparkline (ascending). */
  spark: number[];
  currentCtl: number;
  priorCtl: number;
  changePct: number; // over the comparison window
  windowWeeks: number; // how many weeks the comparison spans
  direction: ProgressDirection;
  onTrack: boolean; // climbing counts as on-track for a build
  label: string; // e.g. "Fitness +9% over 6 weeks"
}

/** A meaningful CTL move; below this is "holding". */
const FLAT_BAND_PCT = 3;

/** Weekly-sample the series (last point of each ISO-ish 7-day bucket) so the
 *  sparkline is clean regardless of how many daily points came in. */
function weeklySample(points: CtlPoint[]): number[] {
  if (points.length === 0) return [];
  const out: number[] = [];
  for (let i = points.length - 1; i >= 0; i -= 7) out.push(points[i].ctl);
  return out.reverse();
}

export function summarizeGoalProgress(points: CtlPoint[], comparisonDays = 42): GoalProgress | null {
  const clean = points.filter((p) => Number.isFinite(p.ctl));
  if (clean.length < 2) return null;

  const current = clean[clean.length - 1].ctl;
  // Compare against ~comparisonDays ago, or the earliest point we have if the
  // series is shorter than that.
  const priorIdx = Math.max(0, clean.length - 1 - comparisonDays);
  const prior = clean[priorIdx].ctl;
  const spanDays = clean.length - 1 - priorIdx;
  const windowWeeks = Math.max(1, Math.round(spanDays / 7));

  const changePct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : 0;
  const direction: ProgressDirection =
    changePct > FLAT_BAND_PCT ? 'climbing' : changePct < -FLAT_BAND_PCT ? 'declining' : 'holding';

  const sign = changePct > 0 ? '+' : '';
  const label =
    direction === 'climbing'
      ? `Fitness ${sign}${changePct}% over ${windowWeeks} weeks — climbing`
      : direction === 'declining'
        ? `Fitness ${changePct}% over ${windowWeeks} weeks — slipping`
        : `Fitness flat over ${windowWeeks} weeks`;

  return {
    spark: weeklySample(clean),
    currentCtl: Math.round(current * 10) / 10,
    priorCtl: Math.round(prior * 10) / 10,
    changePct,
    windowWeeks,
    direction,
    onTrack: direction === 'climbing',
    label,
  };
}
