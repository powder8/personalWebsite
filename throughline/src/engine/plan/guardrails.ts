/**
 * Autonomous-mode guardrails. Pure and deterministic: given an athlete's recent
 * state and the size of a proposed plan change, decide whether it's safe to
 * auto-publish or whether a human should look first.
 *
 * Philosophy: the engine is the same in assisted and autonomous mode. What
 * differs is the APPROVAL GATE. Autonomous mode only auto-publishes when nothing
 * looks off; anything ambiguous escalates to a human (fail safe, not silent).
 */
type Band = 'easy' | 'normal' | 'go';

export type EscalationKind =
  | 'active_injury'
  | 'repeated_low_readiness'
  | 'large_plan_change'
  | 'stale_data';

export interface Escalation {
  kind: EscalationKind;
  reason: string;
}

export interface GuardrailInput {
  hasActiveInjury: boolean;
  /** Recent readiness bands (any order); repeated 'easy' implies something off. */
  recentReadinessBands: Band[];
  /** Sessions changed by the proposed plan vs the current published week. */
  planChangedSessions: number;
  planTotalSessions: number;
  /** Whether we have fresh enough data to assess at all. */
  hasRecentData: boolean;
}

export interface GuardrailResult {
  pass: boolean;
  escalations: Escalation[];
}

export const GUARDRAIL_THRESHOLDS = {
  lowReadinessCount: 3, // of recent days
  largePlanChangeFraction: 0.5,
};

export function evaluateGuardrails(input: GuardrailInput): GuardrailResult {
  const escalations: Escalation[] = [];

  if (!input.hasRecentData) {
    escalations.push({
      kind: 'stale_data',
      reason: 'No recent data to assess readiness — holding for a human before publishing.',
    });
  }

  if (input.hasActiveInjury) {
    escalations.push({
      kind: 'active_injury',
      reason: 'Active injury on file — injury management should be confirmed by a human.',
    });
  }

  const lowCount = input.recentReadinessBands.filter((b) => b === 'easy').length;
  if (lowCount >= GUARDRAIL_THRESHOLDS.lowReadinessCount) {
    escalations.push({
      kind: 'repeated_low_readiness',
      reason: `Readiness low on ${lowCount} recent days — possible illness/overreaching; needs review.`,
    });
  }

  if (
    input.planTotalSessions > 0 &&
    input.planChangedSessions / input.planTotalSessions > GUARDRAIL_THRESHOLDS.largePlanChangeFraction
  ) {
    escalations.push({
      kind: 'large_plan_change',
      reason: `Proposed plan changes ${input.planChangedSessions}/${input.planTotalSessions} sessions — large swing; confirm before publishing.`,
    });
  }

  return { pass: escalations.length === 0, escalations };
}

export type PublishDecision = 'auto_publish' | 'hold_for_review' | 'draft_assisted';

/** The approval gate: the ONLY behavioral difference between the two modes. */
export function decidePublish(
  mode: 'assisted' | 'autonomous',
  guardrails: GuardrailResult,
): PublishDecision {
  if (mode === 'assisted') return 'draft_assisted'; // a human always approves
  return guardrails.pass ? 'auto_publish' : 'hold_for_review';
}
