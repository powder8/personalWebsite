import 'server-only';
/**
 * Adherence / compliance read model: planned vs actual, week by week. Compares
 * the published plan (directive-overlaid, so it reflects what was actually
 * prescribed) against synced/imported activities. Honest by construction — when
 * no activities overlap the plan, it reports `hasActuals: false` so the UI shows
 * an empty state instead of a wall of "missed".
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { plans, plannedSessions, activities } from '@/db/schema';
import { applyDirectives } from '@/engine/plan';
import { listActiveDirectives } from '@/server/directives';

import {
  evaluateWeek,
  type PlannedRef,
  type ActualRef,
  type ComplianceWeek,
} from '@/server/complianceLogic';

export type { DayStatus, ComplianceDay, ComplianceWeek, SessionVerdict } from '@/server/complianceLogic';

export interface ComplianceReport {
  weeks: ComplianceWeek[];
  hasActuals: boolean;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const DISCIPLINES = new Set(['run', 'bike', 'swim', 'strength']);

export async function getComplianceWeeks(
  athleteId: string,
  today: string,
  weeksBack = 6,
): Promise<ComplianceReport> {
  const db = await getDb();
  const windowStart = addDays(today, -7 * weeksBack);

  // Published plan rows overlapping [windowStart, today]. A multisport athlete
  // has one row PER SPORT per week — they are merged into ONE week below, not
  // reported as separate (and separately-scored) weeks.
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

  const actRows = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        gte(activities.startTime, new Date(`${windowStart}T00:00:00Z`)),
        lte(activities.startTime, new Date(`${addDays(today, 1)}T00:00:00Z`)),
      ),
    );
  const actuals: ActualRef[] = actRows.map((a) => ({
    day: a.startTime.toISOString().slice(0, 10),
    sport: a.sport,
    meters: a.distanceMeters ?? 0,
    seconds: a.durationSeconds ?? 0,
  }));
  const hasActuals = actuals.length > 0;

  const directiveRows = await listActiveDirectives(db, athleteId);

  // Merge plan rows by week, then pull every discipline's sessions for that week.
  const byWeek = new Map<string, { weekStart: string; weekEnd: string; phase: string | null; planIds: string[] }>();
  for (const plan of planRows) {
    const w = byWeek.get(plan.weekStart) ?? { weekStart: plan.weekStart, weekEnd: plan.weekEnd, phase: plan.phase, planIds: [] };
    w.planIds.push(plan.id);
    w.phase ??= plan.phase;
    byWeek.set(plan.weekStart, w);
  }

  const weeks: ComplianceWeek[] = [];
  for (const w of byWeek.values()) {
    const sessions = await db
      .select()
      .from(plannedSessions)
      .where(inArray(plannedSessions.planId, w.planIds))
      .orderBy(asc(plannedSessions.day));

    const planned: PlannedRef[] = [];
    for (const s of sessions) {
      const discipline = DISCIPLINES.has(s.discipline) ? (s.discipline as PlannedRef['discipline']) : 'run';
      // Directives overlay what was ACTUALLY prescribed (an "unavailable" day is
      // rest; reduced volume shortens the distance).
      const adj = applyDirectives(
        {
          day: s.day,
          sessionType: s.sessionType,
          distanceMeters: s.targetDistanceMeters,
        durationSeconds: s.targetDurationSeconds,
          paceFastSecPerKm: s.targetPaceFastSecPerKm,
          paceSlowSecPerKm: s.targetPaceSlowSecPerKm,
        },
        directiveRows,
      );
      planned.push({
        day: s.day,
        discipline,
        sessionType: adj.sessionType,
        targetMeters: adj.distanceMeters ?? 0,
        targetSeconds: adj.durationSeconds ?? 0,
      });
    }

    weeks.push(evaluateWeek({ weekStart: w.weekStart, weekEnd: w.weekEnd, phase: w.phase, today, planned, actuals }));
  }

  return { weeks, hasActuals };
}
