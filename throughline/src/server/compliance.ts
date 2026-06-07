import 'server-only';
/**
 * Adherence / compliance read model: planned vs actual, week by week. Compares
 * the published plan (directive-overlaid, so it reflects what was actually
 * prescribed) against synced/imported activities. Honest by construction — when
 * no activities overlap the plan, it reports `hasActuals: false` so the UI shows
 * an empty state instead of a wall of "missed".
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { plans, plannedSessions, activities } from '@/db/schema';
import { applyDirectives } from '@/engine/plan';
import { listActiveDirectives } from '@/server/directives';

const MI = 1609.344;

export type DayStatus = 'done' | 'partial' | 'missed' | 'upcoming' | 'rest' | 'extra';

export interface ComplianceDay {
  day: string;
  sessionType: string | null; // null = no planned session
  plannedMiles: number;
  actualMiles: number;
  status: DayStatus;
}

export interface ComplianceWeek {
  weekStart: string;
  weekEnd: string;
  phase: string | null;
  plannedMiles: number;
  actualMiles: number;
  sessionsPlanned: number; // non-rest planned days up to today
  sessionsDone: number; // planned days with >=80% of planned distance (or any run if planned dist 0)
  adherencePct: number | null; // sessionsDone / sessionsPlanned, null if none due yet
  days: ComplianceDay[];
}

export interface ComplianceReport {
  weeks: ComplianceWeek[];
  hasActuals: boolean;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function getComplianceWeeks(
  athleteId: string,
  today: string,
  weeksBack = 6,
): Promise<ComplianceReport> {
  const db = await getDb();
  const windowStart = addDays(today, -7 * weeksBack);

  // Published plan weeks overlapping [windowStart, today].
  const planRows = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.athleteId, athleteId),
        eq(plans.status, 'published'),
        gte(plans.weekEnd, windowStart),
        lte(plans.weekStart, today),
      ),
    )
    .orderBy(asc(plans.weekStart));

  if (planRows.length === 0) return { weeks: [], hasActuals: false };

  // Actual miles per day across the window (all activities).
  const actRows = await db
    .select({ startTime: activities.startTime, distanceMeters: activities.distanceMeters })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        gte(activities.startTime, new Date(`${windowStart}T00:00:00Z`)),
        lte(activities.startTime, new Date(`${addDays(today, 1)}T00:00:00Z`)),
      ),
    );
  const actualByDay = new Map<string, number>();
  for (const a of actRows) {
    const day = a.startTime.toISOString().slice(0, 10);
    actualByDay.set(day, (actualByDay.get(day) ?? 0) + (a.distanceMeters ?? 0) / MI);
  }
  const hasActuals = actualByDay.size > 0;

  const directiveRows = await listActiveDirectives(db, athleteId);

  const weeks: ComplianceWeek[] = [];
  for (const plan of planRows) {
    const sessions = await db
      .select()
      .from(plannedSessions)
      .where(eq(plannedSessions.planId, plan.id))
      .orderBy(asc(plannedSessions.day));

    const plannedByDay = new Map<string, { type: string; miles: number }>();
    for (const s of sessions) {
      const adj = applyDirectives(
        {
          day: s.day,
          sessionType: s.sessionType,
          distanceMeters: s.targetDistanceMeters,
          paceFastSecPerKm: s.targetPaceFastSecPerKm,
          paceSlowSecPerKm: s.targetPaceSlowSecPerKm,
        },
        directiveRows,
      );
      plannedByDay.set(s.day, {
        type: adj.sessionType,
        miles: (adj.distanceMeters ?? 0) / MI,
      });
    }

    // Iterate every day of the week so "extra" (unplanned) runs surface too.
    const dayList: ComplianceDay[] = [];
    let plannedMiles = 0;
    let actualMiles = 0;
    let sessionsPlanned = 0;
    let sessionsDone = 0;

    for (let d = plan.weekStart; d <= plan.weekEnd; d = addDays(d, 1)) {
      const planned = plannedByDay.get(d);
      const actual = actualByDay.get(d) ?? 0;
      const isPast = d <= today;
      plannedMiles += planned?.miles ?? 0;
      actualMiles += actual;

      const isRunPlanned = !!planned && planned.type !== 'rest' && planned.miles > 0;
      let status: DayStatus;
      if (!planned || planned.type === 'rest') {
        status = actual > 0 ? 'extra' : 'rest';
      } else if (!isPast) {
        status = 'upcoming';
      } else if (planned.miles === 0) {
        status = actual > 0 ? 'done' : 'missed';
      } else if (actual >= planned.miles * 0.8) {
        status = 'done';
      } else if (actual > 0) {
        status = 'partial';
      } else {
        status = 'missed';
      }

      if (isRunPlanned && isPast) {
        sessionsPlanned++;
        if (status === 'done') sessionsDone++;
      }

      dayList.push({
        day: d,
        sessionType: planned?.type ?? null,
        plannedMiles: planned?.miles ?? 0,
        actualMiles: actual,
        status,
      });
    }

    weeks.push({
      weekStart: plan.weekStart,
      weekEnd: plan.weekEnd,
      phase: plan.phase,
      plannedMiles,
      actualMiles,
      sessionsPlanned,
      sessionsDone,
      adherencePct: sessionsPlanned > 0 ? Math.round((sessionsDone / sessionsPlanned) * 100) : null,
      days: dayList,
    });
  }

  return { weeks: weeks.reverse(), hasActuals }; // most recent week first
}
