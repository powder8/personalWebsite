import 'server-only';
/**
 * Consistency / streak stats wrapper: pulls 8 weeks of compliance and runs the
 * pure computeConsistency. Drives the positive-reinforcement strip on the portal.
 */
import { getComplianceWeeks } from '@/server/compliance';
import { computeConsistency, type ConsistencyStats, type ConsistencyDay } from '@/server/consistencyLogic';

export type { ConsistencyStats } from '@/server/consistencyLogic';

export async function getConsistency(athleteId: string, today: string): Promise<ConsistencyStats | null> {
  const report = await getComplianceWeeks(athleteId, today, 8);
  if (!report.hasActuals) return null;

  const days: ConsistencyDay[] = report.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.day <= today)
    .map((d) => ({ day: d.day, status: d.status, actualMiles: d.actualMiles, crossTrain: d.crossTrainSessions > 0 }));

  // Only completed weeks the athlete was actually ACTIVE in carry a meaningful
  // adherence value — weeks before they started logging shouldn't count as
  // "missed" (that would unfairly tank "weeks hit" for a new athlete).
  const weeklyAdherence = report.weeks
    .filter((w) => w.weekEnd < today && w.actualMiles > 0)
    .map((w) => w.adherencePct);

  return computeConsistency({ today, days, weeklyAdherence });
}
