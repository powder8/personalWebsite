/**
 * PURE plan-coverage logic (no DB). The product rule it enforces: an athlete
 * with a live plan should never face an empty CURRENT week. In assisted mode the
 * engine rolls future weeks forward as DRAFTS awaiting coach approval — but the
 * week the athlete is living in must be published, or the portal shows nothing.
 *
 * `selectDueDraftWeeks` is the rolling publish horizon: publish draft weeks that
 * are current or imminent (within `horizonDays`), leaving further-out weeks as
 * drafts for the coach to review.
 */
export interface PlanWeekRef {
  id: string;
  status: 'draft' | 'published' | 'superseded';
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string; // YYYY-MM-DD (Sunday)
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Draft weeks to publish now: current or within `horizonDays` of today
 * (default 7 ≈ current week + next), leaving further weeks as drafts. */
export function selectDueDraftWeeks(plans: PlanWeekRef[], today: string, horizonDays = 7): string[] {
  const horizon = addDays(today, horizonDays);
  return plans
    .filter((p) => p.status === 'draft' && p.weekEnd >= today && p.weekStart <= horizon)
    .map((p) => p.id);
}

/** Is the day covered by any non-superseded plan week (published or draft)? */
export function isDayCovered(plans: PlanWeekRef[], day: string): boolean {
  return plans.some((p) => p.status !== 'superseded' && p.weekStart <= day && p.weekEnd >= day);
}

/** Is the current week PUBLISHED (what the athlete actually sees)? */
export function isCurrentWeekPublished(plans: PlanWeekRef[], today: string): boolean {
  return plans.some((p) => p.status === 'published' && p.weekStart <= today && p.weekEnd >= today);
}
