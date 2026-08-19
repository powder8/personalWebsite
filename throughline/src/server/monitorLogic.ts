/**
 * PURE proactive-adaptation decisions (no DB — unit-testable).
 *
 * The daily monitor turns SUSTAINED signals into schedule changes. A single bad
 * day is the readiness gate's job (advisory / "how do you feel?"); this only
 * acts on a *pattern* — recovery reading low for several days running — so we
 * don't yo-yo the plan on one poor night's sleep.
 *
 * Everything here returns a plain spec + a human reason; the server maps it to a
 * windowed directive (autonomous → applied; assisted → proposed to the coach).
 */
import type { Band } from '@/server/console';

/** A reduce-volume ease with the coach-facing reason for it. */
export interface RecoveryEase {
  factor: number; // reduce_volume multiplier for the window
  days: number; // window length from today (calendar never moves)
  reason: string; // plain-language "why", surfaced on the plan
}

/**
 * Decide whether a run of low readiness warrants easing the block.
 * `recentBands` is the last N days' readiness bands, oldest→newest (null = no
 * assessment that day). We look at the trailing 3 days:
 *   - 3 straight 'easy'  → recovery is genuinely down → ease ~25% for 4 days
 *   - 2 of last 3 'easy' → trending down → ease ~15% for 3 days
 *   - otherwise          → no plan change (the daily gate handles a one-off)
 */
export function decideRecoveryEase(recentBands: (Band | null)[]): RecoveryEase | null {
  const last3 = recentBands.slice(-3);
  const easy = last3.filter((b) => b === 'easy').length;
  const assessed = last3.filter((b) => b != null).length;
  if (assessed < 2) return null; // not enough signal to act on

  if (last3.length >= 3 && last3.every((b) => b === 'easy')) {
    return {
      factor: 0.75,
      days: 4,
      reason: 'Your recovery has read low 3 days running, easing this block ~25% so the body can catch up.',
    };
  }
  if (easy >= 2) {
    return {
      factor: 0.85,
      days: 3,
      reason: 'Recovery has trended low the last few days, trimming the next few sessions ~15% to stay ahead of it.',
    };
  }
  return null;
}

/** Is a self-set injury check-back due (today on or after the chosen date)? */
export function injuryCheckDue(checkBackDate: string | null, today: string): boolean {
  return checkBackDate != null && today >= checkBackDate;
}

/** Suggested next check-back options (days from today) offered when still sore. */
export const CHECK_BACK_OPTIONS: { label: string; days: number }[] = [
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
];

export function addDaysISO(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
