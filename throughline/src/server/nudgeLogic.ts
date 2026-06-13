/**
 * PURE proactive-nudge decision (no DB, no I/O — unit-testable). Given an
 * athlete's state and the local hour, decide whether to send ONE encouraging
 * email, and what it should say.
 *
 * Coaching philosophy, encoded: nudges keep people SHOWING UP — they are warm,
 * never naggy, never guilt-trips, and never tell anyone to make up missed
 * miles. We send at most one a day (the wrapper enforces that), and we stay
 * quiet when there's nothing useful to say (rest days, already ran, etc).
 */
export type NudgeKind = 'workout_today' | 'streak_protect' | 'comeback';

export interface NudgeInput {
  firstName: string;
  localHour: number; // 0–23 in the athlete's timezone
  todaySession: { sessionType: string; miles: number; isQuality: boolean; label: string } | null;
  loggedToday: boolean; // already ran today
  streakDays: number; // consecutive on-plan days ending yesterday
  layoffDays: number; // days since the last real run (0 = ran today)
  goalName: string | null;
  daysToGoal: number | null;
}

export interface Nudge {
  kind: NudgeKind;
  subject: string;
  body: string; // plain text; the wrapper appends the portal link line
}

const MORNING = (h: number) => h >= 6 && h <= 11;
const EVENING = (h: number) => h >= 16 && h <= 21;
const miStr = (m: number) => (m % 1 === 0 ? `${m}` : m.toFixed(1));

export function decideNudge(input: NudgeInput): Nudge | null {
  const { firstName, localHour, todaySession, loggedToday } = input;
  const name = firstName || 'there';
  const isRestDay = !todaySession || todaySession.sessionType === 'rest' || todaySession.miles <= 0;
  const goalTail =
    input.goalName && input.daysToGoal != null && input.daysToGoal >= 0
      ? ` ${input.daysToGoal} days to ${input.goalName} — every honest day counts.`
      : '';

  // --- Comeback: a genuine layoff, re-engage gently (morning) ---
  if (!loggedToday && input.layoffDays >= 4 && MORNING(localHour)) {
    return {
      kind: 'comeback',
      subject: `Let’s ease back in, ${name}`,
      body: `It's been ${input.layoffDays} days since your last run — no guilt at all, life happens. You haven't lost the fitness; the trick is to start light, not lunge back in. Open your plan and we'll ease the next few days down so the first run back feels good.${goalTail}`,
    };
  }

  // --- Workout today: a real session is on the board, remind in the morning ---
  if (!loggedToday && !isRestDay && MORNING(localHour)) {
    const s = todaySession!;
    const lead = s.isQuality
      ? `Today's a quality day: ${s.label} (${miStr(s.miles)} mi).`
      : `Today's run: ${s.label}, ${miStr(s.miles)} mi.`;
    return {
      kind: 'workout_today',
      subject: s.isQuality ? `Quality day, ${name} 💪` : `Today's run, ${name}`,
      body: `${lead} ${
        s.isQuality
          ? 'This is the work that moves your race time — warm up well, nail the paces, and leave one rep in the tank.'
          : 'Keep it genuinely easy and let it feel boring — easy days are the quiet engine of every PB.'
      }${goalTail}`,
    };
  }

  // --- Streak protection: still time tonight to keep the streak alive ---
  if (!loggedToday && !isRestDay && EVENING(localHour) && input.streakDays >= 3) {
    const s = todaySession!;
    return {
      kind: 'streak_protect',
      subject: `🔥 ${input.streakDays}-day streak — still time, ${name}`,
      body: `You're on a ${input.streakDays}-day roll and today's ${s.label} (${miStr(s.miles)} mi) is still open. No pressure — but if you've got it in you, getting out keeps the momentum going. If today just isn't happening, that's fine too: pick straight back up tomorrow, no make-up miles.${goalTail}`,
    };
  }

  return null;
}
