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
}

export interface TodaySessionLite {
  sessionType: string;
  miles: number;
  paceLabel?: string | null;
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
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mi = (m: number) => (m % 1 === 0 ? `${m}` : m.toFixed(1));
const isRest = (t: TodaySessionLite | null) => !t || t.sessionType === 'rest' || t.miles <= 0;

export function decideNextStep(input: NextStepInput): NextStep {
  const name = input.firstName || 'there';

  // 1) Can't coach without a fitness anchor.
  if (!input.hasAnchor) {
    return {
      kind: 'setup_fitness',
      emoji: '🎯',
      headline: `Let’s set your starting point, ${name}`,
      detail: 'Add a recent race or your typical training pace and I’ll build your whole plan around it.',
      cta: { type: 'scroll', href: '#setup', label: 'Set my fitness' },
      tone: 'action',
    };
  }

  // 2) Anchor but no goal (or the goal race is behind us).
  if (input.goalDone) {
    return {
      kind: 'goal_done',
      emoji: '🎉',
      headline: 'That’s a wrap on this goal',
      detail: 'Big effort. The fitness you built fades fast if it sits — pick your next race or focus and we’ll start a fresh block.',
      cta: { type: 'scroll', href: '#setup', label: 'Set my next goal' },
      tone: 'positive',
    };
  }
  if (!input.hasGoal) {
    return {
      kind: 'set_goal',
      emoji: '🎯',
      headline: 'Pick your next goal',
      detail: 'Choose a race or just “stay fit,” and I’ll build the week-by-week plan to get you there.',
      cta: { type: 'scroll', href: '#setup', label: 'Set a goal' },
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
      detail: `You’ve had ${d} days off — no problem and no cramming. Tap below and I’ll trim the next few days so the first runs back feel good, not brutal.`,
      cta: { type: 'ease_back' },
      tone: 'action',
    };
  }

  // 4) Already ran today → celebrate + point at it; the day is done.
  if (input.ranToday) {
    return {
      kind: 'done_today',
      emoji: '✅',
      headline: 'Today’s run is in the bag',
      detail: 'Nice work — that’s the whole job today. Recover well; tomorrow takes care of itself.',
      cta: { type: 'view_run', label: 'See the run' },
      tone: 'positive',
    };
  }

  // 5) Rest day.
  if (isRest(input.today)) {
    return {
      kind: 'rest_today',
      emoji: '😌',
      headline: 'Rest day — take it',
      detail: 'Recovery is where the training sticks. Nothing to run today; you’re back at it tomorrow.',
      cta: { type: 'none' },
      tone: 'neutral',
    };
  }

  // 6) There's a session today.
  const t = input.today!;
  const paceTail = t.paceLabel ? ` @ ${t.paceLabel}` : '';
  if (input.easeBackApplied) {
    return {
      kind: 'eased_today',
      emoji: '✓',
      headline: 'You’re eased back in',
      detail: `Your next few days are trimmed so the return feels good. Today: ${cap(t.sessionType)} ${mi(t.miles)} mi${paceTail} — already eased for you. Start there, momentum first.`,
      cta: { type: 'none' },
      tone: 'positive',
    };
  }
  return {
    kind: 'today',
    emoji: '🏃',
    headline: `Today: ${cap(t.sessionType)} ${mi(t.miles)} mi`,
    detail: `${paceTail ? `Target${paceTail}. ` : ''}${t.eased ? 'Eased for where you are right now. ' : ''}That’s the one thing today — go get it.`,
    cta: { type: 'none' },
    tone: 'action',
  };
}
