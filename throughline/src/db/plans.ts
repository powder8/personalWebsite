/**
 * Plan persistence: map the engine's PlannedWeek/PlannedDay to plans /
 * planned_sessions and back. Functions take the drizzle `db` explicitly so they
 * work against Neon in production and PGlite in tests.
 *
 * Draft → preview → publish: replans persist as `draft`; `publishPlan` flips one
 * draft to `published` and supersedes any prior published week.
 */
import { and, eq, desc } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { plans, plannedSessions } from './schema';
import * as schema from './schema';
import { addDays } from '@/engine/dates';
import { midpoint, dowMon0 } from '@/engine/plan';
import type {
  PlannedWeek,
  PlannedDay,
  PaceZones,
  RunType,
  ZoneKey,
} from '@/engine/plan';

// A drizzle Postgres DB carrying our schema (Neon or PGlite both satisfy this).
type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type SessionType = (typeof schema.sessionTypeEnum.enumValues)[number];

/** RunType (+ zone for quality) → the schema's session_type enum. */
export function toSessionType(runType: RunType, zone: ZoneKey | null): SessionType {
  switch (runType) {
    case 'recovery':
      return 'recovery';
    case 'easy':
      return 'easy';
    case 'maintenance':
      return 'maintenance';
    case 'long':
      return 'long';
    case 'race':
      return 'race';
    case 'rest':
      return 'rest';
    case 'cross_train':
      return 'cross_train';
    case 'quality':
      switch (zone) {
        case 'threshold':
          return 'threshold';
        case 'interval':
          return 'intervals';
        case 'marathon':
          return 'marathon';
        case 'rep':
          return 'tempo';
        default:
          return 'threshold';
      }
  }
}

/** session_type (+ zone) → engine RunType (for reconstruction). */
function toRunType(sessionType: SessionType): RunType {
  switch (sessionType) {
    case 'recovery':
      return 'recovery';
    case 'easy':
      return 'easy';
    case 'maintenance':
      return 'maintenance';
    case 'long':
      return 'long';
    case 'race':
      return 'race';
    case 'rest':
      return 'rest';
    case 'cross_train':
      return 'cross_train';
    default:
      return 'quality'; // tempo/threshold/intervals/marathon
  }
}

/**
 * Persist generated weeks as DRAFT plans (one plans row + its planned_sessions
 * per week). `zones` resolves numeric pace bounds from each day's zone key.
 */
export async function persistPlanDraft(
  db: DB,
  athleteId: string,
  weeks: PlannedWeek[],
  zones: PaceZones,
  generatedFrom?: unknown,
): Promise<{ planId: string; weekStart: string }[]> {
  const out: { planId: string; weekStart: string }[] = [];

  for (const week of weeks) {
    const [planRow] = await db
      .insert(plans)
      .values({
        athleteId,
        status: 'draft',
        weekStart: week.weekStart,
        weekEnd: addDays(week.weekStart, 6),
        phase: week.phase,
        cycle: week.cycle,
        weeklyTargetMeters: week.targetVolumeMeters,
        rationale: week.rationale,
        generatedFrom: (generatedFrom ?? null) as object | null,
      })
      .returning({ id: plans.id });

    const planId = planRow.id;

    const rows = week.days.map((d) => {
      const range = d.zone ? zones.zones[d.zone] : null;
      return {
        planId,
        athleteId,
        day: d.day,
        sessionType: toSessionType(d.runType, d.zone),
        zone: d.zone,
        targetDistanceMeters: d.distanceMeters,
        targetPaceSecPerKm: range ? midpoint(range) : null,
        targetPaceFastSecPerKm: range?.fastSecPerKm ?? null,
        targetPaceSlowSecPerKm: range?.slowSecPerKm ?? null,
        warmup: d.warmup ?? null,
        cooldown: d.cooldown ?? null,
        segments: (d.segments ?? null) as object | null,
        description: d.description,
        pinned: d.pinned,
      };
    });
    if (rows.length) await db.insert(plannedSessions).values(rows);

    out.push({ planId, weekStart: week.weekStart });
  }

  return out;
}

export interface LoadedPlan {
  planId: string;
  status: string;
  week: PlannedWeek;
}

/**
 * Load one athlete's week as an engine PlannedWeek. Defaults to the most recent
 * plan for that week; pass `status` to pick a specific one (e.g. 'published').
 */
export async function getPlanWeek(
  db: DB,
  athleteId: string,
  weekStart: string,
  status?: 'draft' | 'published' | 'superseded',
): Promise<LoadedPlan | null> {
  const where = status
    ? and(eq(plans.athleteId, athleteId), eq(plans.weekStart, weekStart), eq(plans.status, status))
    : and(eq(plans.athleteId, athleteId), eq(plans.weekStart, weekStart));

  const [plan] = await db.select().from(plans).where(where).orderBy(desc(plans.createdAt)).limit(1);
  if (!plan) return null;

  const sessions = await db
    .select()
    .from(plannedSessions)
    .where(eq(plannedSessions.planId, plan.id))
    .orderBy(plannedSessions.day);

  const days: PlannedDay[] = sessions.map((s) => ({
    day: s.day,
    dow: dowMon0(s.day),
    runType: toRunType(s.sessionType),
    zone: (s.zone as ZoneKey | null) ?? null,
    distanceMeters: s.targetDistanceMeters ?? 0,
    warmup: s.warmup ?? undefined,
    cooldown: s.cooldown ?? undefined,
    segments: (s.segments as PlannedDay['segments']) ?? undefined,
    description: s.description ?? '',
    optionalStrides: false,
    pinned: s.pinned,
  }));

  return {
    planId: plan.id,
    status: plan.status,
    week: {
      weekStart: plan.weekStart,
      phase: (plan.phase as PlannedWeek['phase']) ?? 'base',
      cycle: plan.cycle ?? 1,
      targetVolumeMeters: plan.weeklyTargetMeters ?? 0,
      days,
      rationale: plan.rationale ?? '',
    },
  };
}

/**
 * Publish a draft: mark it published and supersede any other published plan for
 * the same athlete+week. No interactive transaction needed (two independent
 * statements), so this works on Neon's HTTP driver too.
 */
export async function publishPlan(db: DB, planId: string): Promise<void> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new Error(`publishPlan: plan ${planId} not found`);

  // Supersede prior published weeks for this athlete+week.
  await db
    .update(plans)
    .set({ status: 'superseded' })
    .where(
      and(
        eq(plans.athleteId, plan.athleteId),
        eq(plans.weekStart, plan.weekStart),
        eq(plans.status, 'published'),
      ),
    );

  await db.update(plans).set({ status: 'published', publishedAt: new Date() }).where(eq(plans.id, planId));
}
