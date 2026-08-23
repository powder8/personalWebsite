/**
 * Goal tracker DB layer — fetches inputs and builds the verdict. The pure
 * fusion logic lives in goalTrackerLogic.ts (testable without server-only deps).
 */
import type { DB } from '@/db';
import type { ConsistencyStats } from '@/server/consistencyLogic';
import { getRacePlan } from '@/server/racePlan';
import { buildGoalTracker, type GoalTracker } from '@/server/goalTrackerLogic';

export type { GoalTracker, GoalTone, GoalVerdict, BuildGoalTrackerInput } from '@/server/goalTrackerLogic';
export { buildGoalTracker } from '@/server/goalTrackerLogic';

/** Fetch inputs and build the tracker. `consistency` is passed in to avoid a refetch. */
export async function getGoalTracker(
  db: DB,
  athleteId: string,
  today: string,
  consistency: ConsistencyStats | null,
): Promise<GoalTracker | null> {
  const racePlan = await getRacePlan(db, athleteId, today);
  if (!racePlan) return null;
  const daysAway = Math.floor((Date.parse(racePlan.goal.date) - Date.parse(today)) / 86400000);
  return buildGoalTracker({
    goalName: racePlan.goal.name,
    distanceLabel: racePlan.goal.distanceLabel,
    daysAway,
    targetTimeSeconds: racePlan.goal.targetTimeSeconds,
    target: racePlan.target,
    feasibility: racePlan.feasibility,
    consistency,
  });
}
