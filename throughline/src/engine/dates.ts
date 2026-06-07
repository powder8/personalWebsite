/**
 * Pure calendar-day arithmetic on 'YYYY-MM-DD' strings.
 *
 * The engine never reads the clock — every "as of" day is passed in — so the
 * same inputs always produce the same output (architecture principle 1:
 * deterministic and auditable). Date is used here only for fixed arithmetic on
 * explicit inputs.
 */

const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch for a calendar date, ignoring time/zone. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** 'YYYY-MM-DD' n days after the given day (n may be negative). */
export function addDays(iso: string, n: number): string {
  return new Date((dayNumber(iso) + n) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** a - b in whole days. */
export function diffDays(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

/** Inclusive list of 'YYYY-MM-DD' from `from` to `to`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = dayNumber(from); d <= dayNumber(to); d++) {
    out.push(new Date(d * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return out;
}
