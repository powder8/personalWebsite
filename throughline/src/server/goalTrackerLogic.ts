/**
 * PURE goal-tracker verdict (no DB) — the "where do I stand?" hook.
 *
 * Fuses the two halves of "on track" into ONE honest verdict:
 *   1. DESTINATION — can my fitness reach the goal by race day? (the engine's
 *      assessGoalFeasibility: ahead / on_track / stretch / unrealistic)
 *   2. TRAJECTORY  — am I actually doing the training that gets me there?
 *      (consistency: adherence to planned volume + active weeks)
 *
 * A runner can be physiologically capable yet drifting because they aren't
 * doing the work — neither signal catches that alone, so we combine them. The
 * verdict is always paired with the single lever that changes it: honest, but
 * never a dead end.
 */
import type { GoalFeasibility } from '@/engine/plan';
import type { ConsistencyStats } from '@/server/consistencyLogic';

export type GoalVerdict = 'ahead' | 'on_track' | 'stretch' | 'drifting' | 'at_risk';
export type GoalTone = 'positive' | 'caution' | 'risk';

export interface GoalTracker {
  verdict: GoalVerdict;
  tone: GoalTone;
  raceLine: string; // race name, e.g. "Chicago Marathon"
  daysAway: number | null; // days to race day (for the countdown)
  headline: string; // "Sub-3:05 is in reach"
  projectionLine: string | null; // "projected today 3:07 → race day 3:04"
  gapNote: string | null; // the honest "why": the size of the gap + the runway it needs
  fillPct: number; // 0-100, how close the projected outcome is to the goal
  goalMarkerPct: number; // where the goal line sits on the bar
  leftLabel: string;
  rightLabel: string;
  execNote: string | null; // execution read: "4 straight weeks of full training"
  advocateLine: string; // the single lever that moves the verdict
  cta: { label: string; href: string } | null;
}

type Execution = 'strong' | 'okay' | 'slipping' | 'unknown';

function executionLevel(c: ConsistencyStats | null): Execution {
  if (!c) return 'unknown';
  const adh = c.adherence28dPct;
  const aw = c.activeWeeks28d;
  if (adh != null) {
    if (adh >= 85 && aw >= 3) return 'strong';
    if (adh < 65 || aw <= 1) return 'slipping';
    return 'okay';
  }
  if (aw >= 3) return 'strong';
  if (aw <= 1) return 'slipping';
  return 'okay';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
/** h:mm for marathon/half (drop seconds), mm:ss for shorter. */
function clockShort(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.round(s % 60);
  return h > 0 ? `${h}:${pad(m)}` : `${m}:${pad(ss)}`;
}

const GOAL_MARKER = 80;
const FILL: Record<GoalVerdict, number> = {
  ahead: 100,
  on_track: 88,
  stretch: 66,
  drifting: 52,
  at_risk: 36,
};

function execNoteFor(exec: Execution, c: ConsistencyStats | null): string | null {
  if (!c) return null;
  switch (exec) {
    case 'strong':
      return `${c.activeWeeks28d}/4 weeks fully trained`;
    case 'okay':
      return 'Training is steady, keep stacking weeks';
    case 'slipping':
      return c.adherence28dPct != null
        ? `Training ${Math.max(1, 100 - c.adherence28dPct)}% under plan the last 4 weeks`
        : `${c.runs28d} run${c.runs28d === 1 ? '' : 's'} logged in the last 4 weeks`;
    default:
      return null;
  }
}

export interface BuildGoalTrackerInput {
  goalName: string;
  daysAway: number | null;
  targetTimeSeconds: number | null;
  target: { solidSeconds: number; stretchSeconds: number } | null;
  feasibility: GoalFeasibility | null;
  consistency: ConsistencyStats | null;
}

/**
 * A drifting athlete's advice has to fit the calendar in front of them: you
 * can't "rebuild base over two solid weeks" when the race is only days away.
 * Inside the final ~2 weeks the honest play is to arrive rested and race what's
 * already banked, then reset and build afterwards — not to cram.
 */
export function driftingAdvice(days: number | null): string {
  if (days != null && days <= 13) {
    return days <= 1
      ? "Race is basically here, the fitness is banked. Rest up, run smart, and we rebuild after."
      : `Only ${days} days out, too little runway to rebuild base, so don't cram. Arrive rested, race what you've got, and we build it back properly afterwards.`;
  }
  return 'The race is still yours, get two solid weeks back-to-back and the base rebuilds fast.';
}

/** Pure verdict builder. Returns null when there is no goal to track. */
export function buildGoalTracker(input: BuildGoalTrackerInput): GoalTracker | null {
  const { goalName, daysAway, targetTimeSeconds, target, feasibility, consistency } = input;
  if (!goalName) return null;

  const exec = executionLevel(consistency);
  const raceLine = goalName;
  const days = daysAway != null && daysAway >= 0 ? daysAway : null;
  const execNote = execNoteFor(exec, consistency);
  const goalLabel = targetTimeSeconds != null ? clockShort(targetTimeSeconds) : null;

  // No time-based feasibility (no target time, or no fitness anchor yet): judge
  // on execution alone, framed as "are you building toward the race".
  if (!feasibility) {
    const drifting = exec === 'slipping';
    const needsTime = targetTimeSeconds == null;
    return {
      verdict: drifting ? 'drifting' : 'on_track',
      tone: drifting ? 'caution' : 'positive',
      raceLine,
      daysAway: days,
      headline: drifting ? 'You are drifting off plan' : `Building toward ${goalName}`,
      projectionLine: needsTime ? 'No target time set yet' : null,
      gapNote: null,
      fillPct: drifting ? 52 : 78,
      goalMarkerPct: GOAL_MARKER,
      leftLabel: 'training consistency',
      rightLabel: 'race day',
      execNote,
      // Without a target time we can only judge consistency — nudge for the time
      // so the real on-pace verdict (projected finish vs goal) unlocks.
      advocateLine: needsTime
        ? "Add a target time and I'll show you exactly whether you're on pace to hit it, not just building blind."
        : drifting
          ? driftingAdvice(days)
          : 'Keep stacking consistent weeks, that is what shows up on race day.',
      cta: needsTime ? { label: 'Set a target time', href: '#goal-setup' } : null,
    };
  }

  const projected = clockShort(feasibility.projectedTimeSeconds);
  const solid = target ? clockShort(target.solidSeconds) : null;
  const projectionLine =
    solid != null ? `projected today ${solid} → race day ${projected}` : `projected race day ~${projected}`;

  // The honest, non-preachy "why": how big the ask is and how much runway it
  // really needs — straight from the feasibility model, which already computes
  // it. Shown for the two "is this reachable?" verdicts so the athlete can see
  // exactly what they're up against and decide for themselves.
  const gapPct =
    targetTimeSeconds != null && feasibility.projectedTimeSeconds > 0
      ? Math.round(((feasibility.projectedTimeSeconds - targetTimeSeconds) / feasibility.projectedTimeSeconds) * 100)
      : null;
  const weeksLeft = feasibility.weeksToRace;
  const weeksNeeded = feasibility.weeksNeededForGoal;
  let gapNote: string | null = null;
  if (feasibility.verdict === 'unrealistic' && goalLabel) {
    // Say the quiet part: the projected time already ASSUMES a consistent
    // block, so the athlete can see consistency isn't the lever that unlocks
    // the goal here — the runway is.
    const gapClause =
      gapPct != null && gapPct > 0
        ? `${goalLabel} is about ${gapPct}% faster than a fully consistent block projects for race day (~${projected}). `
        : `${goalLabel} is ahead of what a fully consistent block projects for race day (~${projected}). `;
    const runwayClause =
      weeksNeeded && weeksNeeded > weeksLeft
        ? `A normal build to it runs ~${weeksNeeded} weeks, more than the ${weeksLeft} this race gives. It's a genuine season goal.`
        : `Closing it needs consistent, structured weeks between now and race day.`;
    gapNote = gapClause + runwayClause;
  } else if (feasibility.verdict === 'stretch' && goalLabel) {
    gapNote = `${goalLabel} asks for a strong ${weeksLeft}-week block, a good build gets you close; stack the weeks and see how near you land.`;
  }

  // Destination verdict, then let execution downgrade a capable athlete who
  // isn't doing the work.
  let verdict: GoalVerdict;
  if (feasibility.verdict === 'ahead') verdict = 'ahead';
  else if (feasibility.verdict === 'unrealistic') verdict = 'at_risk';
  else if (feasibility.verdict === 'on_track') verdict = exec === 'slipping' ? 'drifting' : 'on_track';
  else verdict = exec === 'slipping' ? 'drifting' : 'stretch'; // 'stretch'

  const tone: GoalTone =
    verdict === 'at_risk' ? 'risk' : verdict === 'drifting' || verdict === 'stretch' ? 'caution' : 'positive';

  const headline =
    verdict === 'ahead'
      ? 'You are ahead of your goal'
      : verdict === 'on_track'
        ? goalLabel
          ? `${goalLabel} is in reach`
          : 'Your goal is in reach'
        : verdict === 'stretch'
          ? goalLabel
            ? `${goalLabel} is a real stretch`
            : 'A real stretch, reachable if it clicks'
          : verdict === 'drifting'
            ? goalLabel
              ? `${goalLabel} is slipping`
              : 'Your goal is slipping'
            : goalLabel
              ? `${goalLabel} needs a longer runway`
              : 'This goal needs a longer runway';

  const leftLabel =
    verdict === 'at_risk'
      ? `projected ${projected}`
      : verdict === 'drifting'
        ? consistency?.adherence28dPct != null
          ? `${consistency.adherence28dPct}% of planned miles`
          : `${consistency?.activeWeeks28d ?? 0}/4 active weeks`
        : verdict === 'stretch'
          ? 'reachable if it clicks'
          : verdict === 'ahead'
            ? solid
              ? `now ${solid}`
              : 'at goal fitness'
            : 'fitness climbing';

  // At-risk splits into two honest, separately-attributed levers:
  //   • consistency protects the REALISTIC race-day result (the projection
  //     assumes it — and if the athlete is slipping, even that is at risk);
  //   • runway is what makes the GOAL itself a season target, not this race.
  // We only invoke consistency when it's actually the live lever (slipping).
  const slipping = exec === 'slipping';
  const runsPhrase =
    consistency == null
      ? null
      : consistency.adherence28dPct != null
        ? `${Math.max(1, 100 - consistency.adherence28dPct)}% under plan`
        : `${consistency.runs28d} run${consistency.runs28d === 1 ? '' : 's'} in 4 weeks`;
  // Affirm the ambitious goal and promise ONGOING EVALUATION rather than nagging
  // to lower it — the projection is recomputed from current fitness every time,
  // so "I'll keep checking your trajectory" is literally true. Adjusting stays a
  // quiet option (the cta), not the daily push.
  const atRiskAdvocate =
    slipping && runsPhrase
      ? `That ~${projected} assumes consistent training, and at ${runsPhrase} right now it's slipping. Get consistent and you protect it — ${goalLabel ?? 'the goal'} stays the season target, and I'll keep checking whether your trajectory is closing on it.`
      : `You're doing the work — keep ${goalLabel ?? 'it'} as your season target and chase a strong ~${projected} at this race. I'll re-check your trajectory as you build; if your fitness climbs fast enough, ${goalLabel ?? 'it'} stays in play.`;

  const advocateLine =
    verdict === 'ahead'
      ? 'Hold this fitness, or let\'s aim a notch faster and make the race count.'
      : verdict === 'on_track'
        ? 'Keep protecting your long run and key session, it\'s yours to lose.'
        : verdict === 'stretch'
          ? 'It\'s the ceiling, not the floor. Stack consistent weeks and see how close you get.'
          : verdict === 'drifting'
            ? 'The goal is still alive. Nail this week\'s key session and long run and you\'re back on the line.'
            : atRiskAdvocate;

  return {
    verdict,
    tone,
    raceLine,
    daysAway: days,
    headline,
    projectionLine,
    gapNote,
    fillPct: FILL[verdict],
    goalMarkerPct: GOAL_MARKER,
    leftLabel,
    rightLabel: goalLabel ? `${goalLabel} goal` : 'goal',
    // For at-risk the consistency read is woven into the advocate as a lever,
    // so the separate badge would just be a redundant scold.
    execNote: verdict === 'at_risk' ? null : execNote,
    advocateLine,
    cta: verdict === 'at_risk' ? { label: 'Adjust goal or race', href: '#goal-setup' } : null,
  };
}
