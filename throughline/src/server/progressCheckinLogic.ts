/**
 * The 4-week progress check-in message (PURE). Every ~4 weeks we tell the athlete
 * how their projected finish moved and whether they're trending toward the goal —
 * the "regular evaluation" that lets them chase a big goal without being nagged to
 * lower it. Composed from the live projection + the fitness (CTL) trend; no
 * fabricated history.
 */
import type { ProgressDirection } from '@/server/goalProgressLogic';

export interface CheckinInput {
  firstName: string;
  distanceLabel: string | null; // "Marathon"
  projectedLabel: string; // realistic race-day finish, e.g. "5:07"
  goalLabel: string | null; // target time, e.g. "2:50"
  daysToGoal: number | null;
  /** Fitness trend over the window. */
  fitnessChangePct: number;
  fitnessDirection: ProgressDirection;
  /** True when the projection already meets or beats the goal. */
  onPace: boolean;
}

export interface CheckinMessage {
  subject: string;
  body: string;
}

export function buildCheckinMessage(input: CheckinInput): CheckinMessage {
  const race = input.distanceLabel ? `${input.distanceLabel.toLowerCase()} ` : '';
  const sign = input.fitnessChangePct > 0 ? '+' : '';
  const trend =
    input.fitnessDirection === 'climbing'
      ? `Your fitness climbed ${sign}${input.fitnessChangePct}% over the last few weeks`
      : input.fitnessDirection === 'declining'
        ? `Your fitness slipped ${input.fitnessChangePct}% over the last few weeks`
        : `Your fitness held flat over the last few weeks`;

  const subject = input.onPace
    ? `On pace for your ${race}goal — 4-week check-in`
    : `Your ${race}projection: 4-week check-in`;

  const daysLine =
    input.daysToGoal != null && input.daysToGoal >= 0 ? ` You’re ${input.daysToGoal} days out.` : '';

  // Lead with the read, then the number, then the honest next step.
  const verdictLine = input.onPace
    ? `You're projecting to hit it. Keep the trend going.`
    : input.fitnessDirection === 'climbing'
      ? `Keep this up and the projection keeps closing on your goal.`
      : input.fitnessDirection === 'declining'
        ? `The projection stalled. A couple of consistent weeks turns it back around.`
        : `Steady, but flat. Stack a couple of harder-but-consistent weeks to start closing the gap.`;

  const goalClause = input.goalLabel ? ` toward your ${input.goalLabel} goal` : '';
  const body =
    `Hi ${input.firstName},\n\n` +
    `${trend}. Your projected ${race}finish is now about ${input.projectedLabel}${goalClause}.${daysLine}\n\n` +
    `${verdictLine}\n\n` +
    `Open your plan to see the full trajectory.`;

  return { subject, body };
}
