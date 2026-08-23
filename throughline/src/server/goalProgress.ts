import 'server-only';
/**
 * Goal-progress read: the athlete's fitness (CTL) trend for the goal card's
 * "on track?" sparkline. Thin wrapper over the fitness series + the pure
 * {@link summarizeGoalProgress}.
 */
import { getFitnessFatigueSeries } from '@/server/fitness';
import { summarizeGoalProgress, type GoalProgress } from '@/server/goalProgressLogic';

export type { GoalProgress } from '@/server/goalProgressLogic';

export async function getGoalProgress(athleteId: string, today: string): Promise<GoalProgress | null> {
  // ~12 weeks of fitness history; the summary compares now vs ~6 weeks back.
  const series = await getFitnessFatigueSeries(athleteId, 84);
  void today;
  return summarizeGoalProgress(series.points.map((p) => ({ day: p.day, ctl: p.ctl })));
}
