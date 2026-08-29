/**
 * PURE "one next step" decision (no DB). The automatic-coach athlete should
 * always see a single, unambiguous thing to do RIGHT NOW — whatever lifecycle
 * state they're in. This collapses the scattered prompts (set fitness, pick a
 * goal, ease back, today's session, rest, done, race over) into one focal CTA.
 *
 * Priority order matters: blockers first (no fitness → no goal), then the
 * return-from-layoff flow, then "did you already run", then today's work.
 */
export type NextStepKind =
  | 'setup_fitness'
  | 'set_goal'
  | 'goal_done'
  | 'ease_back'
  | 'eased_today'
  | 'done_today'
  | 'rest_today'
  | 'today'
  | 'all_set';

export type NextStepCta =
  | { type: 'scroll'; href: string; label: string }
  | { type: 'ease_back' }
  | { type: 'view_run'; label: string }
  | { type: 'none' };

export interface NextStep {
  kind: NextStepKind;
  emoji: string;
  headline: string;
  detail: string;
  cta: NextStepCta;
  tone: 'action' | 'positive' | 'neutral';
  /**
   * Optional wearable-readiness advisory attached to a session day. Advisory
   * only — it never rewrites the plan (that's the coach's / autopilot's job),
   * it just tells the athlete how their body is trending into today's work.
   */
  readinessNote?: { text: string; tone: 'caution' | 'go' };
}

export type ReadinessBand = 'easy' | 'normal' | 'go';

export type SessionDiscipline = 'run' | 'bike' | 'swim' | 'strength';

export interface TodaySessionLite {
  sessionType: string;
  discipline: SessionDiscipline;
  miles: number; // run volume
  durationMinutes?: number; // bike volume
  meters?: number; // swim volume
  targetLabel?: string | null; // run pace / bike watts / swim pace-per-100m
  eased: boolean;
}

export interface NextStepInput {
  firstName: string;
  hasAnchor: boolean;
  hasGoal: boolean;
  goalDone: boolean;
  layoffDays: number | null;
  easeBackAvailable: boolean; // returning, ease-back offered but not yet taken
  easeBackApplied: boolean; // ease-back directive is active
  ranToday: boolean;
  today: TodaySessionLite | null; // today's planned session (null/rest = nothing to run)
  /**
   * The sports actually LOGGED today (distinct: 'run' | 'bike' | 'swim' | …).
   * The "done" headline names what you did, not what was planned — an athlete
   * who ran when a ride was scheduled still ran. Empty → fall back to the plan.
   */
  loggedSports?: string[];
  /** Today's wearable readiness band, if known (drives an advisory on the session). */
  readinessBand?: ReadinessBand | null;
  /**
   * How this athlete is coached. In assisted mode a low-readiness day shows a
   * coach-facing advisory. In autonomous mode there is no coach, so the
   * low-readiness case is handled interactively by the readiness gate (which
   * asks the athlete how they feel first) — the banner stays silent on it.
   */
  coachingMode?: 'assisted' | 'autonomous';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mi = (m: number) => (m % 1 === 0 ? `${m}` : m.toFixed(1));

/** A session's volume in its OWN native unit (run miles / bike minutes / swim metres). */
function sessionVolume(t: TodaySessionLite): number {
  return t.discipline === 'bike' || t.discipline === 'strength'
    ? t.durationMinutes ?? 0
    : t.discipline === 'swim'
      ? t.meters ?? 0
      : t.miles;
}
/** Discipline-native volume label for a headline: "5 mi" · "45 min" · "2000 m". */
function volumeLabel(t: TodaySessionLite): string {
  if (t.discipline === 'bike' || t.discipline === 'strength') return `${Math.round(t.durationMinutes ?? 0)} min`;
  if (t.discipline === 'swim') return `${Math.round(t.meters ?? 0)} m`;
  return `${mi(t.miles)} mi`;
}
// Rest = no session, typed rest, or zero volume in the session's OWN unit (a bike
// day has miles 0 but real minutes — the old miles-only gate wrongly hid it).
const isRest = (t: TodaySessionLite | null) => !t || t.sessionType === 'rest' || sessionVolume(t) <= 0;

// Intensity/volume sessions where low recovery matters most.
const QUALITY_SESSIONS = new Set(['intervals', 'tempo', 'threshold', 'marathon', 'race', 'long']);
export const isQualitySession = (sessionType: string) => QUALITY_SESSIONS.has(sessionType);

/** Advisory note for a session day given today's readiness band. */
function readinessNoteFor(
  session: TodaySessionLite,
  band: ReadinessBand | null | undefined,
  coachingMode: 'assisted' | 'autonomous',
): NextStep['readinessNote'] {
  if (!band) return undefined;
  const quality = isQualitySession(session.sessionType);
  if (band === 'go' && quality) {
    return { tone: 'go', text: 'Recovery is green today, a good day to attack this one.' };
  }
  // Autonomous mode routes the low-readiness case through the interactive gate,
  // so the banner doesn't pre-empt it with a static caution here.
  if (band === 'easy' && coachingMode !== 'autonomous') {
    return {
      tone: 'caution',
      text: quality
        ? 'Heads up: your recovery is running low today. Consider dialing the intensity back or moving the hard work to a fresher day, and check in with your coach if it persists.'
        : 'Your recovery is running low today, keep this one genuinely easy and let the body catch up.',
    };
  }
  return undefined;
}

export function decideNextStep(input: NextStepInput): NextStep {
  const name = input.firstName || 'there';

  // 1) Can't coach without a fitness anchor.
  if (!input.hasAnchor) {
    return {
      kind: 'setup_fitness',
      emoji: '🎯',
      headline: `Let’s set your starting point, ${name}`,
      detail: 'Add a recent race or your typical training pace and I’ll build your whole plan around it.',
      cta: { type: 'scroll', href: '#goal-setup', label: 'Set my fitness' },
      tone: 'action',
    };
  }

  // 2) Anchor but no goal (or the goal race is behind us).
  if (input.goalDone) {
    return {
      kind: 'goal_done',
      emoji: '🎉',
      headline: 'That’s a wrap on this goal',
      detail: 'Big effort. The fitness you built fades fast if it sits, pick your next race or focus and we’ll start a fresh block.',
      cta: { type: 'scroll', href: '#goal-setup', label: 'Set my next goal' },
      tone: 'positive',
    };
  }
  if (!input.hasGoal) {
    return {
      kind: 'set_goal',
      emoji: '🎯',
      headline: 'Pick your next goal',
      detail: 'Choose a race or just “stay fit,” and I’ll build the week-by-week plan to get you there.',
      cta: { type: 'scroll', href: '#goal-setup', label: 'Set a goal' },
      tone: 'action',
    };
  }

  // 3) Returning from a real layoff and hasn't eased yet → offer it here.
  if (input.easeBackAvailable && !input.easeBackApplied) {
    const d = input.layoffDays ?? 0;
    return {
      kind: 'ease_back',
      emoji: '👋',
      headline: `Welcome back, ${name}`,
      detail: `You’ve had ${d} days off, no problem and no cramming. Tap below and I’ll trim the next few days so the first runs back feel good, not brutal.`,
      cta: { type: 'ease_back' },
      tone: 'action',
    };
  }

  // 4) Already did today's session → celebrate + point at it; the day is done.
  //    Discipline-aware: a ride/swim/strength session is "done", not just a run.
  if (input.ranToday) {
    const nounFor = (s: string) =>
      s === 'bike' ? 'ride' : s === 'swim' ? 'swim' : s === 'strength' ? 'strength session' : s === 'run' ? 'run' : 'session';
    // Name what was actually DONE. Prefer the logged sport(s); only fall back to
    // the planned discipline when nothing specific was logged.
    const logged = input.loggedSports ?? [];
    const primary = logged.length === 1 ? logged[0] : logged.length === 0 ? input.today?.discipline ?? 'run' : null;
    const headline = primary ? `Today’s ${nounFor(primary)} is in the bag` : 'Today’s training is in the bag';
    // "See the run" deep-links the run debrief — only when a run was actually run.
    const showRun = primary === 'run' || (primary == null && logged.includes('run'));
    return {
      kind: 'done_today',
      emoji: '✅',
      headline,
      detail: 'Nice work, that’s the whole job today. Recover well; tomorrow takes care of itself.',
      cta: showRun ? { type: 'view_run', label: 'See the run' } : { type: 'none' },
      tone: 'positive',
    };
  }

  // 5) Rest day.
  if (isRest(input.today)) {
    return {
      kind: 'rest_today',
      emoji: '😌',
      headline: 'Rest day, take it',
      detail: 'Recovery is where the training sticks. Nothing to run today; you’re back at it tomorrow.',
      cta: { type: 'none' },
      tone: 'neutral',
    };
  }

  // 6) There's a session today.
  const t = input.today!;
  const paceTail = t.targetLabel ? ` @ ${t.targetLabel}` : '';
  const readinessNote = readinessNoteFor(t, input.readinessBand, input.coachingMode ?? 'assisted');
  if (input.easeBackApplied) {
    return {
      kind: 'eased_today',
      emoji: '✓',
      headline: 'You’re eased back in',
      detail: `Your next few days are trimmed so the return feels good. Today: ${cap(t.sessionType)} ${volumeLabel(t)}${paceTail}, already eased for you. Start there, momentum first.`,
      cta: { type: 'none' },
      tone: 'positive',
      readinessNote,
    };
  }
  return {
    kind: 'today',
    emoji: t.discipline === 'bike' ? '🚴' : t.discipline === 'swim' ? '🏊' : t.discipline === 'strength' ? '💪' : '🏃',
    headline: `Today: ${cap(t.sessionType)} ${volumeLabel(t)}`,
    detail: `${paceTail ? `Target${paceTail}. ` : ''}${t.eased ? 'Eased for where you are right now. ' : ''}That’s the one thing today, go get it.`,
    cta: { type: 'none' },
    tone: 'action',
    readinessNote,
  };
}
