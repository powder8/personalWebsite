/**
 * PURE helpers for the daily monitor (no DB — unit-testable).
 *
 * Sustained recovery patterns (illness, overreaching, under-recovery) are now
 * detected and answered by the body-status engine (engine/body); what remains
 * here is the injury check-back schedule and date arithmetic.
 */

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
