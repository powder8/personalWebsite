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
export type NudgeKind = 'workout_today' | 'streak_protect' | 'comeback' | 'progress_checkin';

export type NudgeDiscipline = 'run' | 'bike' | 'swim' | 'strength';

export interface NudgeSession {
  sessionType: string;
  discipline: NudgeDiscipline;
  /** Volume in the session's OWN unit: "5.0 mi" / "45 min" / "2,000 m". */
  volumeLabel: string;
  /** Real work prescribed, judged in the session's own unit (a 45-min ride has
   *  0 miles and is still a session). */
  hasWork: boolean;
  isQuality: boolean;
  label: string;
}

export interface NudgeInput {
  firstName: string;
  localHour: number; // 0-23 in the athlete's timezone
  todaySession: NudgeSession | null;
  loggedToday: boolean; // already trained today, in ANY sport
  streakDays: number; // consecutive on-plan days ending yesterday
  layoffDays: number; // days since the last session in ANY sport (0 = trained today)
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
const NOUN: Record<NudgeDiscipline, string> = { run: 'run', bike: 'ride', swim: 'swim', strength: 'strength session' };

export function decideNudge(input: NudgeInput): Nudge | null {
  const { firstName, localHour, todaySession, loggedToday } = input;
  const name = firstName || 'there';
  const isRestDay = !todaySession || todaySession.sessionType === 'rest' || !todaySession.hasWork;
  const noun = todaySession ? NOUN[todaySession.discipline] : 'session';
  const goalTail =
    input.goalName && input.daysToGoal != null && input.daysToGoal >= 0
      ? ` ${input.daysToGoal} days to ${input.goalName}, every honest day counts.`
      : '';

  // --- Comeback: a genuine layoff, re-engage gently (morning) ---
  if (!loggedToday && input.layoffDays >= 4 && MORNING(localHour)) {
    return {
      kind: 'comeback',
      subject: `Let’s ease back in, ${name}`,
      body: `It's been ${input.layoffDays} days since you last trained, no guilt at all, life happens. You haven't lost the fitness; the trick is to start light, not lunge back in. Open your plan and we'll ease the next few days down so the first session back feels good.${goalTail}`,
    };
  }

  // --- Workout today: a real session is on the board, remind in the morning ---
  if (!loggedToday && !isRestDay && MORNING(localHour)) {
    const s = todaySession!;
    const lead = s.isQuality
      ? `Today's a quality day: ${s.label} (${s.volumeLabel}).`
      : `Today's ${noun}: ${s.label}, ${s.volumeLabel}.`;
    return {
      kind: 'workout_today',
      subject: s.isQuality ? `Quality day, ${name} 💪` : `Today's ${noun}, ${name}`,
      body: `${lead} ${
        s.isQuality
          ? 'This is the work that moves your race time, warm up well, hit the targets, and leave one rep in the tank.'
          : 'Keep it genuinely easy and let it feel boring, easy days are the quiet engine of every PB.'
      }${goalTail}`,
    };
  }

  // --- Streak protection: still time tonight to keep the streak alive ---
  if (!loggedToday && !isRestDay && EVENING(localHour) && input.streakDays >= 3) {
    const s = todaySession!;
    return {
      kind: 'streak_protect',
      subject: `🔥 ${input.streakDays}-day streak, still time, ${name}`,
      body: `You're on a ${input.streakDays}-day roll and today's ${s.label} (${s.volumeLabel}) is still open. No pressure, but if you've got it in you, getting out keeps the momentum going. If today just isn't happening, that's fine too: pick straight back up tomorrow, nothing to make up.${goalTail}`,
    };
  }

  return null;
}
