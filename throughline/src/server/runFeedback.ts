import 'server-only';
/**
 * "Coach's take" on a completed run: loads the activity + the planned session
 * for that day (from the published plan) and runs the pure assessor. Thin
 * wrapper over runFeedbackLogic.ts.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, plannedSessions, plans } from '@/db/schema';
import { assessRun, type RunFeedback, type PlannedRef } from '@/server/runFeedbackLogic';
import { pickPrimaryRun, summarizeRunDay } from '@/server/runDayLogic';
import { gapFromSplits, secPerKmToMinPerMile, type GapSplit } from '@/engine/plan';

export type { RunFeedback } from '@/server/runFeedbackLogic';

const MI = 1609.344;
const pm = (secPerKm: number) => `${secPerKmToMinPerMile(secPerKm)}/mi`;

/**
 * Judge effort on grade-adjusted pace when the terrain actually moved the
 * needle, so a hilly run isn't scored on its (slower/faster) raw pace. Returns
 * the effort pace + a one-line note to append when an adjustment was applied.
 */
function effortPace(rawSecPerKm: number | null, splits: unknown): { pace: number | null; note: string } {
  const gap = gapFromSplits(splits as GapSplit[] | null);
  if (!gap || !gap.significant) return { pace: rawSecPerKm, note: '' };
  return {
    pace: gap.gapSecPerKm,
    note: ` (Hilly route, ${Math.round(gap.climbMeters * 3.28084)} ft of climb, so this is judged on grade-adjusted ${pm(
      gap.gapSecPerKm,
    )} vs ${pm(gap.rawSecPerKm)} actual.)`,
  };
}

/** Find the published-plan session for an athlete on a given day, if any. */
async function plannedFor(athleteId: string, day: string): Promise<PlannedRef | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      sessionType: plannedSessions.sessionType,
      zone: plannedSessions.zone,
      meters: plannedSessions.targetDistanceMeters,
      fast: plannedSessions.targetPaceFastSecPerKm,
      slow: plannedSessions.targetPaceSlowSecPerKm,
    })
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(and(eq(plannedSessions.athleteId, athleteId), eq(plannedSessions.day, day), eq(plans.status, 'published')))
    .limit(1);
  if (!row) return null;
  return {
    sessionType: row.sessionType,
    zone: row.zone,
    miles: row.meters != null ? row.meters / MI : 0,
    paceFastSecPerKm: row.fast,
    paceSlowSecPerKm: row.slow,
  };
}

/** Coach's take for one specific run (the run detail page). */
export async function getRunFeedback(athleteId: string, activityId: string): Promise<RunFeedback | null> {
  const db = await getDb();
  const [run] = await db
    .select({
      startTime: activities.startTime,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      splits: activities.splits,
      sport: activities.sport,
    })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.athleteId, athleteId)))
    .limit(1);
  if (!run || run.sport !== 'run' || run.distanceMeters == null || run.distanceMeters < MI * 0.4) return null;
  const day = run.startTime.toISOString().slice(0, 10);
  const planned = await plannedFor(athleteId, day);
  const { pace, note } = effortPace(run.avgPaceSecPerKm, run.splits);
  const feedback = assessRun({ actualMiles: run.distanceMeters / MI, actualPaceSecPerKm: pace, planned });
  if (note) feedback.detail += note;
  return feedback;
}

/**
 * Coach's take on the athlete's most recent run DAY (portal card), with a link.
 * Crucially, when a day has several runs (warm-up + race + cool-down), it picks
 * the PRIMARY effort — not whichever uploaded last — and reports the day total.
 */
export async function getLatestRunFeedback(
  athleteId: string,
  today: string,
  lookbackDays = 14, // show the last run for a couple of weeks, not just 3 days
): Promise<{
  feedback: RunFeedback;
  activityId: string;
  day: string;
  daysAgo: number;
  runCount: number;
  dayMiles: number;
} | null> {
  const db = await getDb();
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const rows = await db
    .select({
      id: activities.id,
      startTime: activities.startTime,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      splits: activities.splits,
      workoutType: activities.workoutType,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.sport, 'run'), gte(activities.startTime, since), lte(activities.startTime, new Date(`${today}T23:59:59Z`))))
    .orderBy(desc(activities.startTime));
  if (rows.length === 0) return null;

  // The most recent day that has a real run, then everything logged that day.
  const latestDay = rows[0].startTime.toISOString().slice(0, 10);
  const dayRows = rows
    .filter((r) => r.startTime.toISOString().slice(0, 10) === latestDay)
    .filter((r) => r.distanceMeters != null && r.distanceMeters >= MI * 0.4);
  if (dayRows.length === 0) return null;

  const primary = pickPrimaryRun(
    dayRows.map((r) => ({ activityId: r.id, workoutType: r.workoutType, miles: (r.distanceMeters ?? 0) / MI, paceSecPerKm: r.avgPaceSecPerKm })),
  );
  const run = dayRows.find((r) => r.id === primary?.activityId) ?? dayRows[0];
  const summary = summarizeRunDay(dayRows.map((r) => ({ workoutType: r.workoutType, miles: (r.distanceMeters ?? 0) / MI, paceSecPerKm: r.avgPaceSecPerKm })));

  const planned = await plannedFor(athleteId, latestDay);
  const { pace, note } = effortPace(run.avgPaceSecPerKm, run.splits);
  const feedback = assessRun({ actualMiles: (run.distanceMeters ?? 0) / MI, actualPaceSecPerKm: pace, planned });
  if (note) feedback.detail += note;
  const daysAgo = Math.round(
    (Date.UTC(...(today.split('-').map(Number) as [number, number, number])) -
      Date.UTC(...(latestDay.split('-').map(Number) as [number, number, number]))) /
      86400000,
  );
  return { feedback, activityId: run.id, day: latestDay, daysAgo, runCount: summary.count, dayMiles: summary.totalMiles };
}
