import 'server-only';
/**
 * Read model for the unified training calendar (`/me/[id]` centerpiece). Pulls
 * the athlete's published plan and ALL their activities (runs + cross-training)
 * across a window spanning a few weeks back through the published horizon, then
 * hands directive-overlaid maps to the pure assembler. The result is one
 * continuous planned-vs-actual timeline.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { plans, plannedSessions, activities } from '@/db/schema';
import { applyDirectives } from '@/engine/plan';
import { listActiveDirectives } from '@/server/directives';
import {
  assembleCalendar,
  addDays,
  mondayOf,
  metersToMiles,
  type CalWeek,
  type CalPlanned,
  type CalActual,
} from '@/server/trainingCalendarLogic';

const RUN_SPORTS = new Set(['run']);

export interface TrainingCalendar {
  weeks: CalWeek[];
  hasActuals: boolean;
}

export async function getTrainingCalendar(
  athleteId: string,
  today: string,
  opts: { pastWeeks?: number; futureWeeks?: number } = {},
): Promise<TrainingCalendar> {
  const { pastWeeks = 8, futureWeeks = 4 } = opts;
  const db = await getDb();

  const rangeStart = addDays(mondayOf(today), -7 * pastWeeks);
  const rangeEnd = addDays(mondayOf(today), 7 * futureWeeks + 6); // through Sunday of last future week

  // Published planned sessions in range (week phase comes along via the join).
  const planRows = await db
    .select({
      day: plannedSessions.day,
      sessionType: plannedSessions.sessionType,
      discipline: plannedSessions.discipline,
      zone: plannedSessions.zone,
      targetDistanceMeters: plannedSessions.targetDistanceMeters,
      targetDurationSeconds: plannedSessions.targetDurationSeconds,
      targetLoadTss: plannedSessions.targetLoad,
      targetPaceFastSecPerKm: plannedSessions.targetPaceFastSecPerKm,
      targetPaceSlowSecPerKm: plannedSessions.targetPaceSlowSecPerKm,
      description: plannedSessions.description,
      weekStart: plans.weekStart,
      phase: plans.phase,
    })
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(
      and(
        eq(plannedSessions.athleteId, athleteId),
        eq(plans.status, 'published'),
        gte(plannedSessions.day, rangeStart),
        lte(plannedSessions.day, rangeEnd),
      ),
    )
    .orderBy(asc(plannedSessions.day));

  const directiveRows = await listActiveDirectives(db, athleteId);

  const plannedByDay = new Map<string, CalPlanned[]>();
  const phaseByWeekStart = new Map<string, string | null>();
  for (const r of planRows) {
    phaseByWeekStart.set(r.weekStart, r.phase);
    const adj = applyDirectives(
      {
        day: r.day,
        sessionType: r.sessionType,
        distanceMeters: r.targetDistanceMeters,
        paceFastSecPerKm: r.targetPaceFastSecPerKm,
        paceSlowSecPerKm: r.targetPaceSlowSecPerKm,
      },
      directiveRows,
    );
    const discipline = (r.discipline ?? 'run') as 'run' | 'bike' | 'swim';
    const session: CalPlanned = {
      sessionType: adj.sessionType,
      discipline,
      zone: r.zone,
      // Native volume per discipline; run's `miles` is unchanged.
      miles: discipline === 'run' ? metersToMiles(adj.distanceMeters) : 0,
      durationMinutes: discipline === 'bike' ? (r.targetDurationSeconds ?? 0) / 60 : 0,
      meters: discipline === 'swim' ? (adj.distanceMeters ?? 0) : 0,
      loadTss: r.targetLoadTss ?? 0,
      paceFastSecPerKm: adj.paceFastSecPerKm,
      paceSlowSecPerKm: adj.paceSlowSecPerKm,
      description: r.description,
      adjustments: adj.adjustments,
    };
    const existing = plannedByDay.get(r.day);
    if (existing) existing.push(session);
    else plannedByDay.set(r.day, [session]);
  }

  // All activities in range — runs AND cross-training.
  const actRows = await db
    .select({
      id: activities.id,
      sport: activities.sport,
      workoutType: activities.workoutType,
      name: activities.name,
      startTime: activities.startTime,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      elevationGainMeters: activities.elevationGainMeters,
      surface: activities.surface,
      avgHr: activities.avgHr,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        gte(activities.startTime, new Date(`${rangeStart}T00:00:00Z`)),
        lte(activities.startTime, new Date(`${addDays(rangeEnd, 1)}T00:00:00Z`)),
      ),
    )
    .orderBy(asc(activities.startTime));

  const actualsByDay = new Map<string, CalActual[]>();
  for (const a of actRows) {
    const day = a.startTime.toISOString().slice(0, 10);
    const cal: CalActual = {
      activityId: a.id,
      sport: a.sport,
      isRun: RUN_SPORTS.has(a.sport),
      workoutType: a.workoutType,
      name: a.name,
      miles: metersToMiles(a.distanceMeters),
      paceSecPerKm: a.avgPaceSecPerKm,
      durationSeconds: a.durationSeconds,
      elevationGainMeters: a.elevationGainMeters,
      surface: a.surface,
      avgHr: a.avgHr,
    };
    const list = actualsByDay.get(day);
    if (list) list.push(cal);
    else actualsByDay.set(day, [cal]);
  }
  const hasActuals = actualsByDay.size > 0;

  // Week-start Mondays across the whole window.
  const weekStarts: string[] = [];
  for (let w = mondayOf(rangeStart); w <= rangeEnd; w = addDays(w, 7)) weekStarts.push(w);

  const weeks = assembleCalendar({ today, weekStarts, plannedByDay, actualsByDay, phaseByWeekStart });
  return { weeks, hasActuals };
}
