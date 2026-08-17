/**
 * PURE missed-day adaptation logic (no DB, no server-only — unit-testable).
 *
 * The coaching philosophy, encoded: a missed day is forgiven, never "made up"
 * (stacking miles is how people get hurt and quit), and the CALENDAR NEVER
 * MOVES — adaptation changes the CONTENT of upcoming days in place, via the
 * engine's windowed directives. The product job here is mostly psychological:
 * keep the athlete showing up.
 *
 * Daniels' "time off" guidance drives the ease-back: up to ~4 days off costs no
 * real fitness (just carry on); a genuine layoff returns EASIER, scaled to how
 * long they were away — not by trying to cram the gap.
 */
import type { DayStatus } from '@/server/compliance';

export interface AdherenceDay {
  day: string; // YYYY-MM-DD
  status: DayStatus;
  actualMiles: number;
  sessionType: string | null;
}

export type AdaptationTone = 'on_track' | 'slipped' | 'returning';

/** A coach-reviewable, in-place ease-back (maps to windowed directives). */
export interface EaseBack {
  factor: number; // reduce_volume multiplier for the next `days`
  days: number; // window length from today (calendar unchanged)
  paceEaseSecPerMile?: number; // optional slower paces while ramping back
  rebuildSuggested: boolean; // very long layoff → suggest re-setting the goal
}

export interface AdaptationState {
  tone: AdaptationTone;
  show: boolean; // whether it's worth surfacing a card at all
  streakDays: number; // consecutive on-plan days ending at the last past day
  missedRecent: number; // missed/partial run days in the window
  layoffDays: number; // days since the last actual run (0 = ran today)
  lastRunDay: string | null;
  headline: string;
  body: string;
  easeBack: EaseBack | null;
  /** An ease-back is already active (directive applied) — show confirmation, not the CTA. */
  easeBackApplied?: boolean;
}

function dayDiff(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function analyzeAdherence(input: {
  today: string;
  days: AdherenceDay[]; // chronological, within the look-back window
  lastRunDay: string | null;
}): AdaptationState | null {
  const past = input.days.filter((d) => d.day < input.today).sort((a, b) => a.day.localeCompare(b.day));
  const layoffDays = input.lastRunDay ? dayDiff(input.lastRunDay, input.today) : 9999;
  // Nothing to say if there's no adherence history AND no genuine layoff
  // (no past planned days, and either never ran or ran very recently).
  if (past.length === 0 && (input.lastRunDay == null || layoffDays < 4)) return null;

  // Streak: from the most recent past day backward, count days that didn't drop
  // the ball (done / planned-rest / extra run). A missed or partial run breaks it.
  let streakDays = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    const s = past[i].status;
    if (s === 'done' || s === 'rest' || s === 'extra') streakDays++;
    else break;
  }
  const missedRecent = past.filter((d) => d.status === 'missed' || d.status === 'partial').length;

  // --- Returning from a genuine layoff (≥4 days since a real run) ---
  if (layoffDays >= 4 && layoffDays < 9999) {
    let easeBack: EaseBack;
    let body: string;
    if (layoffDays <= 7) {
      easeBack = { factor: 0.8, days: 5, rebuildSuggested: false };
      body = `You've had ${layoffDays} days off, totally fine, you haven't lost real fitness. The trick is to ease in, not lunge back into hard work. Tap below and we'll trim the next few days ~20% so the first runs back feel good, not brutal. We are NOT cramming the missed miles in, that's how people get hurt.`;
    } else if (layoffDays <= 14) {
      easeBack = { factor: 0.7, days: 6, paceEaseSecPerMile: 10, rebuildSuggested: false };
      body = `It's been about ${Math.round(layoffDays / 7)} week${layoffDays >= 14 ? 's' : ''} since your last run, no guilt, life happens. We'll bring the next few days down ~30% and a touch slower so you rebuild safely. Your race dates don't change; we just start lighter.`;
    } else {
      easeBack = { factor: 0.6, days: 7, paceEaseSecPerMile: 15, rebuildSuggested: true };
      body = `After ${layoffDays} days away, the smart move is to rebuild gently from easy running rather than pick up mid-plan. We'll ease the next week right down. Worth a quick chat with your coach, or re-setting your goal, so the plan matches where you are now.`;
    }
    return {
      tone: 'returning',
      show: true,
      streakDays,
      missedRecent,
      layoffDays,
      lastRunDay: input.lastRunDay,
      headline: 'Welcome back 👋',
      body,
      easeBack,
    };
  }

  // --- Slipped: missed a session or two but still running (ran within ~3 days) ---
  if (missedRecent >= 1) {
    const headline = missedRecent >= 3 ? 'A few missed, no guilt.' : 'Missed a day? It happens.';
    const body =
      missedRecent >= 3
        ? `Life gets in the way, and consistency over weeks beats any single session. The worst move would be to pile the missed runs onto the next few days. We're leaving the plan as-is; today's run is your clean reset. Easy does it.`
        : `One session won't derail your race, and we are NOT making up the miles (that's how niggles start). Just pick straight back up with today's run, showing up again is the whole game.`;
    return {
      tone: 'slipped',
      show: true,
      streakDays,
      missedRecent,
      layoffDays,
      lastRunDay: input.lastRunDay,
      headline,
      body,
      easeBack: null,
    };
  }

  // --- On track: only celebrate a real streak (otherwise stay out of the way) ---
  return {
    tone: 'on_track',
    show: streakDays >= 4,
    streakDays,
    missedRecent,
    layoffDays,
    lastRunDay: input.lastRunDay,
    headline: `🔥 ${streakDays} days on plan`,
    body: 'Consistency is the entire game, this is exactly how race fitness gets built. Keep showing up.',
    easeBack: null,
  };
}
