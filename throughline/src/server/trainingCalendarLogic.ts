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
  discipline: 'run' | 'bike' | 'swim';
  zone: string | null;
  miles: number; // run volume
  durationMinutes: number; // bike volume
  meters: number; // swim volume
  loadTss: number;
  paceFastSecPerKm: number | null;
  paceSlowSecPerKm: number | null;
  description: string | null;
  adjustments: string[];
}

/** Does a planned day carry real work, in ITS discipline's own unit? (A bike
 * day has miles 0 but real minutes — the run-only `miles > 0` test hid it.) */
export function plannedHasWork(p: CalPlanned | null): boolean {
  if (!p || p.sessionType === 'rest') return false;
  if (p.discipline === 'bike') return p.durationMinutes > 0;
  if (p.discipline === 'swim') return p.meters > 0;
  return p.miles > 0;
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
  plannedMinutes: number; // bike planned minutes
  actualMinutes: number; // bike actual minutes
  plannedMeters: number; // swim planned metres
  actualMeters: number; // swim actual metres
  /** The week's dominant planned discipline — drives the weekly-total unit. */
  primaryDiscipline: 'run' | 'bike' | 'swim';
  sessionsPlanned: number; // planned session days up to today (any discipline)
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
  acts: CalActual[],
  runMiles: number,
  hasCross: boolean,
  isFuture: boolean,
  isToday: boolean,
): CalStatus {
  const hasWork = plannedHasWork(planned);
  if (isFuture) return hasWork ? 'upcoming' : 'rest';
  if (hasWork) {
    if (planned!.discipline === 'run') {
      if (runMiles >= planned!.miles * 0.8) return 'done';
      if (runMiles > 0) return 'partial';
      // Today with nothing logged yet is still TO DO — never "missed" mid-day.
      return isToday ? 'upcoming' : 'missed';
    }
    // Bike/swim: matched by whether a same-discipline activity was logged that
    // day (duration/TSS matching comes with the activity-ingest work).
    const did = acts.some((a) => a.sport === planned!.discipline);
    if (did) return 'done';
    return isToday ? 'upcoming' : 'missed';
  }
  // No session was planned (rest or nothing).
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
    let plannedMinutes = 0;
    let actualMinutes = 0;
    let plannedMeters = 0;
    let actualMeters = 0;
    let sessionsPlanned = 0;
    let sessionsDone = 0;
    const plannedByDiscipline: Record<'run' | 'bike' | 'swim', number> = { run: 0, bike: 0, swim: 0 };

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

      const status = dayStatus(planned, acts, runMiles, crossTrain.length > 0, isFuture, isToday);

      // Per-discipline planned/actual accumulation (run miles unchanged).
      plannedMiles += planned?.miles ?? 0;
      actualMiles += runMiles;
      if (plannedHasWork(planned)) {
        plannedByDiscipline[planned!.discipline]++;
        if (planned!.discipline === 'bike') plannedMinutes += planned!.durationMinutes;
        if (planned!.discipline === 'swim') plannedMeters += planned!.meters;
      }
      for (const a of acts) {
        if (a.sport === 'bike') actualMinutes += (a.durationSeconds ?? 0) / 60;
        if (a.sport === 'swim') actualMeters += a.miles * MI;
      }
      // Count a planned session toward adherence once it's genuinely DUE: any past
      // day, plus today only if the session was actually logged (don't tank % mid-day).
      // Run's "logged today" test (runMiles > 0) is preserved exactly.
      if (plannedHasWork(planned)) {
        const loggedToday = planned!.discipline === 'run' ? runMiles > 0 : status === 'done';
        if (day < today || (isToday && loggedToday)) {
          sessionsPlanned++;
          if (status === 'done') sessionsDone++;
        }
      }

      // Inline coach's take for the run that happened (deterministic). Only a
      // planned RUN day supplies a target to grade against.
      const plannedRunDay = plannedHasWork(planned) && planned!.discipline === 'run';
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

    // Dominant planned discipline drives the weekly-total unit; ties favour run,
    // so a pure-run week is byte-identical.
    const primaryDiscipline: 'run' | 'bike' | 'swim' =
      plannedByDiscipline.bike > plannedByDiscipline.run && plannedByDiscipline.bike >= plannedByDiscipline.swim
        ? 'bike'
        : plannedByDiscipline.swim > plannedByDiscipline.run && plannedByDiscipline.swim > plannedByDiscipline.bike
          ? 'swim'
          : 'run';

    weeks.push({
      weekStart,
      weekEnd,
      phase: phaseByWeekStart.get(weekStart) ?? null,
      plannedMiles,
      actualMiles,
      plannedMinutes,
      actualMinutes,
      plannedMeters,
      actualMeters,
      primaryDiscipline,
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
