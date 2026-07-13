/**
 * PURE aggregation helpers for the admin analytics page (no DB). Kept separate
 * from the fetch layer so the bucketing/distribution math is unit-testable.
 */

export interface WeekBucket {
  weekStart: string; // Monday, YYYY-MM-DD
  count: number;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function dayFromNumber(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** Monday of the week containing `day` (ISO weeks, matching the plan engine). */
export function mondayOf(day: string): string {
  const dn = dayNumber(day);
  const dow = ((dn % 7) + 3) % 7; // 0 = Monday (1970-01-01 was a Thursday)
  return dayFromNumber(dn - dow);
}

/**
 * Bucket ISO dates into the trailing `nWeeks` Monday-anchored weeks ending with
 * the week containing `today`. Dates outside the window are ignored; empty
 * weeks are kept (a growth chart with missing weeks lies about the pace).
 */
export function bucketByWeek(days: string[], today: string, nWeeks: number): WeekBucket[] {
  const lastMonday = mondayOf(today);
  const buckets = new Map<string, number>();
  for (let i = nWeeks - 1; i >= 0; i--) {
    buckets.set(dayFromNumber(dayNumber(lastMonday) - i * 7), 0);
  }
  for (const day of days) {
    const wk = mondayOf(day);
    if (buckets.has(wk)) buckets.set(wk, (buckets.get(wk) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([weekStart, count]) => ({ weekStart, count }));
}

/** Count occurrences of each key, returned sorted by count descending. */
export function distribution<K extends string>(keys: (K | null | undefined)[]): { key: K; count: number }[] {
  const m = new Map<K, number>();
  for (const k of keys) {
    if (k == null) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
