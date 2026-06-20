/**
 * PURE assembly for the unified training calendar — one continuous timeline of
 * PLANNED vs ACTUAL, week by week. No DB; unit-testable. The server layer
 * fetches + directive-overlays the plan and the activities, then hands flat maps
 * here; this turns them into Mon–Sun week rows with a per-day status and an
 * inline "Coach's take" verdict for the run that happened.
 *
 * Design intent (Peter): collapse "past weeks" and "upcoming weeks" into ONE
 * surface, bind expected-vs-actual on the same day, surface per-day feedback,
 * and keep cross-training visible (supporting context, never confused with the
 * run target).
 */
import { assessRun, type RunFeedback } from '@/server/runFeedbackLogic';
import { pickPrimaryRun } from '@/server/runDayLogic';

const MI = 1609.344;

export interface CalPlanned {
  sessionType: string;
  zone: string | null;
  miles: number;
  paceFastSecPerKm: number | null;
  paceSlowSecPerKm: number | null;
  description: string | null;
  adjustments: string[];
}

export interface CalActual {
  activityId: string;
  sport: string; // run | bike | swim | strength | cross_train | other
  isRun: boolean;
  workoutType: number | null; // Strava: 1 = race, 2 = long, 3 = workout
  name: string | null;
  miles: number;
  paceSecPerKm: number | null;
  durationSeconds: number | null;
  elevationGainMeters: number | null;
  surface: string | null;
  avgHr: number | null;
}

export type CalStatus =
  | 'done' // planned run hit (>=80% distance)
  | 'partial' // ran, but short
  | 'missed' // planned run, nothing run
  | 'upcoming' // future planned run
  | 'rest' // rest day, nothing logged
  | 'extra' // unplanned bonus run
  | 'cross'; // only cross-training that day (no run)

export interface CalDay {
  day: string;
  dow: number; // 0 = Mon … 6 = Sun
  isToday: boolean;
  isFuture: boolean;
  planned: CalPlanned | null;
  actuals: CalActual[];
  primaryRun: CalActual | null; // longest run that day, if any
  crossTrain: CalActual[]; // non-run activities
  status: CalStatus;
  verdict: RunFeedback | null; // coach's take for the primary run
}

export interface CalWeek {
  weekStart: string; // Monday
  weekEnd: string; // Sunday
  phase: string | null;
  plannedMiles: number;
  actualMiles: number; // run miles only
  sessionsPlanned: number; // planned run days up to today
  sessionsDone: number;
  adherencePct: number | null;
  isCurrent: boolean;
  days: CalDay[];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Mon … 6 = Sun. */
export function dowIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return ((Math.floor(Date.UTC(y, m - 1, d) / 86400000) % 7) + 3) % 7;
}

/** The Monday on or before `day`. */
export function mondayOf(day: string): string {
  return addDays(day, -dowIndex(day));
}

export interface AssembleInput {
  today: string;
  /** Mondays to render, oldest first. */
  weekStarts: string[];
  /** Planned (already directive-overlaid) keyed by YYYY-MM-DD. */
  plannedByDay: Map<string, CalPlanned>;
  /** Actuals keyed by YYYY-MM-DD (a day can hold several). */
  actualsByDay: Map<string, CalActual[]>;
  /** Plan phase keyed by week-start Monday. */
  phaseByWeekStart: Map<string, string | null>;
}

function dayStatus(
  planned: CalPlanned | null,
  runMiles: number,
  hasCross: boolean,
  isFuture: boolean,
  isToday: boolean,
): CalStatus {
  const plannedRun = !!planned && planned.sessionType !== 'rest' && planned.miles > 0;
  if (isFuture) return plannedRun ? 'upcoming' : 'rest';
  if (plannedRun) {
    if (runMiles >= planned!.miles * 0.8) return 'done';
    if (runMiles > 0) return 'partial';
    // Today with nothing logged yet is still TO DO — never "missed" mid-day.
    return isToday ? 'upcoming' : 'missed';
  }
  // No run was planned (rest or nothing).
  if (runMiles > 0) return 'extra';
  if (hasCross) return 'cross';
  return 'rest';
}

export function assembleCalendar(input: AssembleInput): CalWeek[] {
  const { today, weekStarts, plannedByDay, actualsByDay, phaseByWeekStart } = input;
  const weeks: CalWeek[] = [];

  for (const weekStart of weekStarts) {
    const weekEnd = addDays(weekStart, 6);
    const days: CalDay[] = [];
    let plannedMiles = 0;
    let actualMiles = 0;
    let sessionsPlanned = 0;
    let sessionsDone = 0;

    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const planned = plannedByDay.get(day) ?? null;
      const acts = actualsByDay.get(day) ?? [];
      const runs = acts.filter((a) => a.isRun);
      const crossTrain = acts.filter((a) => !a.isRun);
      // Race/workout-aware: a warm-up+race+cool-down day evaluates the RACE, not
      // whichever upload was longest or last.
      const primaryRun = pickPrimaryRun(runs);
      const runMiles = runs.reduce((sum, a) => sum + a.miles, 0);
      const isFuture = day > today;
      const isToday = day === today;

      const status = dayStatus(planned, runMiles, crossTrain.length > 0, isFuture, isToday);

      plannedMiles += planned?.miles ?? 0;
      actualMiles += runMiles;
      const plannedRunDay = !!planned && planned.sessionType !== 'rest' && planned.miles > 0;
      // Count a planned session toward adherence once it's genuinely DUE: any past
      // day, plus today only if a run was actually logged (don't tank % mid-day).
      if (plannedRunDay && (day < today || (isToday && runMiles > 0))) {
        sessionsPlanned++;
        if (status === 'done') sessionsDone++;
      }

      // Inline coach's take for the run that happened (deterministic).
      let verdict: RunFeedback | null = null;
      if (primaryRun && !isFuture) {
        verdict = assessRun({
          actualMiles: primaryRun.miles,
          actualPaceSecPerKm: primaryRun.paceSecPerKm,
          planned: plannedRunDay
            ? {
                sessionType: planned!.sessionType,
                zone: planned!.zone,
                miles: planned!.miles,
                paceFastSecPerKm: planned!.paceFastSecPerKm,
                paceSlowSecPerKm: planned!.paceSlowSecPerKm,
              }
            : null,
        });
      }

      days.push({
        day,
        dow: i,
        isToday: day === today,
        isFuture,
        planned,
        actuals: acts,
        primaryRun,
        crossTrain,
        status,
        verdict,
      });
    }

    weeks.push({
      weekStart,
      weekEnd,
      phase: phaseByWeekStart.get(weekStart) ?? null,
      plannedMiles,
      actualMiles,
      sessionsPlanned,
      sessionsDone,
      adherencePct: sessionsPlanned > 0 ? Math.round((sessionsDone / sessionsPlanned) * 100) : null,
      isCurrent: weekStart <= today && today <= weekEnd,
      days,
    });
  }

  return weeks;
}

/** Convenience for callers that have meters. */
export const metersToMiles = (m: number | null | undefined): number => (m == null ? 0 : m / MI);
