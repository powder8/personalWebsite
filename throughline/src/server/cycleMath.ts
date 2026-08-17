/**
 * Pure menstrual-cycle projection math — no DB, no server-only. Kept separate
 * from cycle.ts so it can be unit-tested and (type-)shared with client code.
 */
export interface CycleSettings {
  enabled: boolean;
  lastStartDate: string | null;
  avgCycleDays: number;
  avgPeriodDays: number;
}

export type CyclePhase = 'menstrual' | 'follicular' | 'luteal';

export interface CycleStatus {
  enabled: boolean;
  settings: CycleSettings;
  phase: CyclePhase | null;
  dayInCycle: number | null;
  nextStart: string | null;
  daysUntilNext: number | null;
  lateLuteal: boolean; // last ~4 days before next cycle, fatigue more likely
  upcoming: { start: string; periodEnd: string }[]; // next few projected cycles
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function diffDays(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Project the current phase + upcoming cycles from settings, as of `today`. */
export function computeCycle(settings: CycleSettings, today: string): CycleStatus {
  const base: CycleStatus = {
    enabled: settings.enabled,
    settings,
    phase: null,
    dayInCycle: null,
    nextStart: null,
    daysUntilNext: null,
    lateLuteal: false,
    upcoming: [],
  };
  if (!settings.enabled || !settings.lastStartDate) return base;

  const { lastStartDate, avgCycleDays, avgPeriodDays } = settings;
  const daysSince = diffDays(lastStartDate, today);
  const cyclesPassed = daysSince >= 0 ? Math.floor(daysSince / avgCycleDays) : 0;
  const currentStart = addDays(lastStartDate, cyclesPassed * avgCycleDays);
  const dayInCycle = diffDays(currentStart, today) + 1; // day 1 = start day
  const nextStart = addDays(currentStart, avgCycleDays);
  const daysUntilNext = diffDays(today, nextStart);
  const lateLuteal = daysUntilNext <= 4 && daysUntilNext >= 0;

  let phase: CyclePhase;
  if (dayInCycle <= avgPeriodDays) phase = 'menstrual';
  else if (dayInCycle <= Math.round(avgCycleDays / 2)) phase = 'follicular';
  else phase = 'luteal';

  const upcoming = [1, 2, 3].map((i) => {
    const start = addDays(currentStart, i * avgCycleDays);
    return { start, periodEnd: addDays(start, avgPeriodDays - 1) };
  });

  return { ...base, phase, dayInCycle, nextStart, daysUntilNext, lateLuteal, upcoming };
}
