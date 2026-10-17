/** Calendar-day helpers. Pure (no server-only), so tests can import them. */

/**
 * The app's "today" (YYYY-MM-DD), computed per call in the app timezone —
 * APP_TIMEZONE env, default Europe/London. Overridable with APP_TODAY for
 * demos/tests (this is how the original seeded-demo date worked).
 */
export function todayISO(): string {
  if (process.env.APP_TODAY) return process.env.APP_TODAY;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * "Today" for ONE athlete, in their own timezone. An athlete's day must roll
 * over at their midnight, not London's: otherwise a US athlete sees tomorrow's
 * session from ~7pm Eastern. 'UTC' is the column default (timezone never
 * captured), so it falls back to the app timezone like todayISO().
 */
export function todayForTimezone(tz: string | null | undefined): string {
  if (process.env.APP_TODAY) return process.env.APP_TODAY;
  if (!tz || tz === 'UTC') return todayISO();
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return todayISO(); // unknown IANA name
  }
}
