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
  crossTrain?: boolean; // a bike/swim/strength session happened that day
}

export interface ConsistencyStats {
  show: boolean;
  currentStreak: number; // consecutive active days ending at the most recent past day
  longestStreak: number; // best active run within the window
  weeksTracked: number; // completed weeks with a due adherence value
  weeksHit: number; // of those, weeks at >=80% adherence
  /** Of the last 4 calendar weeks, how many had ≥ 4 active days (run OR XT). */
  activeWeeks28d: number;
  runs28d: number; // runs logged in the last 28 days
  miles28d: number; // miles logged in the last 28 days
  crossTrain28d: number; // cross-training days in the last 28 days
  activeDays28d: number; // days with a run OR cross-training in the last 28 days
  adherence28dPct: number | null; // mean of weekly adherence over the window
  headline: string; // short positive line
}

const ON_PLAN: ReadonlySet<DayStatus> = new Set<DayStatus>(['done', 'rest', 'extra']);
const HIT_THRESHOLD = 80;
// A day "counts" for the streak if it was on-plan OR you cross-trained — showing
// up on the bike still keeps the habit alive (cross-training credit, per coach).
const isActive = (d: ConsistencyDay): boolean => ON_PLAN.has(d.status) || d.crossTrain === true;

export function computeConsistency(input: {
  today: string;
  days: ConsistencyDay[]; // chronological
  weeklyAdherence: (number | null)[]; // completed weeks, oldest→newest, 0..100 or null
}): ConsistencyStats {
  const past = input.days.filter((d) => d.day <= input.today).sort((a, b) => a.day.localeCompare(b.day));

  // Streaks over active days (on-plan OR cross-trained). A missed/partial run with
  // no cross-training breaks it; upcoming is ignored.
  let current = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    if (past[i].status === 'upcoming') continue; // future-but-listed shouldn't break a streak
    if (isActive(past[i])) current++;
    else break;
  }
  let longest = 0;
  let run = 0;
  for (const d of past) {
    if (d.status === 'upcoming') continue;
    if (isActive(d)) {
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
  const crossTrain28d = last28.filter((d) => d.crossTrain === true).length;
  const activeDays28d = last28.filter((d) => d.actualMiles > 0 || d.crossTrain === true).length;

  // Active weeks: divide last 28 days into 4 sequential 7-day windows (oldest → newest).
  // A week is "active" when ≥ 4 of its 7 days had a run OR cross-training session.
  // This intentionally includes XT — a consistent aerobic week counts whether it’s
  // all running or a mix of runs and cross-training.
  const sorted28 = [...last28].sort((a, b) => a.day.localeCompare(b.day));
  let activeWeeks28d = 0;
  for (let w = 0; w < 4; w++) {
    const week = sorted28.slice(w * 7, (w + 1) * 7);
    const activeDays = week.filter((d) => d.actualMiles > 0 || d.crossTrain === true).length;
    if (activeDays >= 4) activeWeeks28d++;
  }

  const headline =
    current >= 3
      ? `🔥 ${current}-day streak`
      : activeWeeks28d >= 3
        ? `${activeWeeks28d}/4 weeks fully active`
        : activeDays28d >= 1
          ? 'Building momentum'
          : "Let’s get rolling";

  return {
    show: activeDays28d >= 2 || current >= 3,
    currentStreak: current,
    longestStreak: longest,
    weeksTracked,
    weeksHit,
    activeWeeks28d,
    runs28d,
    miles28d,
    crossTrain28d,
    activeDays28d,
    adherence28dPct,
    headline,
  };
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
