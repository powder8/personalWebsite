/**
 * PURE consistency / streak stats (no DB) — the positive-reinforcement read
 * model. Coaching truth: consistency over weeks is the single best predictor of
 * improvement, so we surface it as something to be proud of and protect.
 */
import type { DayStatus } from '@/server/compliance';

export interface ConsistencyDay {
  day: string; // YYYY-MM-DD
  status: DayStatus;
  actualMiles: number;
}

export interface ConsistencyStats {
  show: boolean;
  currentStreak: number; // consecutive on-plan days ending at the most recent past day
  longestStreak: number; // best on-plan run within the window
  weeksTracked: number; // completed weeks with a due adherence value
  weeksHit: number; // of those, weeks at >=80% adherence
  runs28d: number; // runs logged in the last 28 days
  miles28d: number; // miles logged in the last 28 days
  adherence28dPct: number | null; // mean of weekly adherence over the window
  headline: string; // short positive line
}

const ON_PLAN: ReadonlySet<DayStatus> = new Set<DayStatus>(['done', 'rest', 'extra']);
const HIT_THRESHOLD = 80;

export function computeConsistency(input: {
  today: string;
  days: ConsistencyDay[]; // chronological
  weeklyAdherence: (number | null)[]; // completed weeks, oldest→newest, 0..100 or null
}): ConsistencyStats {
  const past = input.days.filter((d) => d.day <= input.today).sort((a, b) => a.day.localeCompare(b.day));

  // Streaks over on-plan days (a missed/partial run breaks it; upcoming is ignored).
  let current = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    const s = past[i].status;
    if (s === 'upcoming') continue; // future-but-listed shouldn't break a streak
    if (ON_PLAN.has(s)) current++;
    else break;
  }
  let longest = 0;
  let run = 0;
  for (const d of past) {
    if (d.status === 'upcoming') continue;
    if (ON_PLAN.has(d.status)) {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }

  const due = input.weeklyAdherence.filter((p): p is number => p != null);
  const weeksTracked = due.length;
  const weeksHit = due.filter((p) => p >= HIT_THRESHOLD).length;
  const adherence28dPct = weeksTracked > 0 ? Math.round(due.reduce((a, b) => a + b, 0) / weeksTracked) : null;

  const cutoff = addDays(input.today, -27);
  const last28 = past.filter((d) => d.day >= cutoff);
  const runs28d = last28.filter((d) => d.actualMiles > 0).length;
  const miles28d = Math.round(last28.reduce((a, d) => a + d.actualMiles, 0));

  const headline =
    current >= 3
      ? `🔥 ${current}-day streak`
      : weeksHit >= 2
        ? `${weeksHit} solid weeks banked`
        : runs28d >= 1
          ? 'Building momentum'
          : 'Let’s get rolling';

  return {
    show: runs28d >= 2 || current >= 3,
    currentStreak: current,
    longestStreak: longest,
    weeksTracked,
    weeksHit,
    runs28d,
    miles28d,
    adherence28dPct,
    headline,
  };
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
