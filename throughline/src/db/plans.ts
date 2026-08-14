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
import { midpoint, dowMon0, isPowerZones, isPaceZones, isSwimZones } from '@/engine/plan';
import type {
  PlannedWeek,
  PlannedDay,
  PaceZones,
  TrainingZones,
  PowerZones,
  PowerZoneKey,
  SwimZones,
  SwimZoneKey,
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
 * per week). `zones` resolves the numeric bounds from each day's zone key —
 * pace bounds on the RUN discipline, watt bounds on the BIKE (duration @ power),
 * CSS-relative metres on the SWIM (distance @ CSS pace). The discipline is
 * inferred from the `zones` arm, so running callers are unchanged and cycling /
 * swimming callers just pass `PowerZones` / `SwimZones`.
 *
 * The bike and swim arms share the TSS-equivalent load currency: both store the
 * weekly load in `weekly_target_tss` and leave `weekly_target_meters` null. Swim
 * additionally carries per-session METRES (reusing `target_distance_meters`) and
 * duration (`target_duration_seconds`) — additive, no new columns.
 */
export async function persistPlanDraft(
  db: DB,
  athleteId: string,
  weeks: PlannedWeek[],
  zones: TrainingZones,
  generatedFrom?: unknown,
  opts: { status?: 'draft' | 'published' } = {},
): Promise<{ planId: string; weekStart: string }[]> {
  const out: { planId: string; weekStart: string }[] = [];
  const bike = isPowerZones(zones);
  const swim = isSwimZones(zones);
  const discipline = swim ? ('swim' as const) : bike ? ('bike' as const) : ('run' as const);
  // Bike and swim both denominate the weekly load in TSS-equivalent; only run
  // carries a meters target.
  const loadIsTss = bike || swim;

  for (const week of weeks) {
    const [planRow] = await db
      .insert(plans)
      .values({
        athleteId,
        status: opts.status ?? 'draft',
        discipline,
        weekStart: week.weekStart,
        weekEnd: addDays(week.weekStart, 6),
        phase: week.phase,
        cycle: week.cycle,
        weeklyTargetMeters: loadIsTss ? null : week.targetVolumeMeters,
        weeklyTargetTss: loadIsTss ? week.targetLoadTss ?? null : null,
        rationale: week.rationale,
        generatedFrom: (generatedFrom ?? null) as object | null,
        publishedAt: opts.status === 'published' ? new Date() : null,
      })
      .returning({ id: plans.id });

    const planId = planRow.id;

    // Narrow per-arm so each row builder gets its exact zone shape.
    const rows = week.days.map((d) => {
      if (isPowerZones(zones)) return bikeSessionRow(planId, athleteId, d, zones);
      if (isSwimZones(zones)) return swimSessionRow(planId, athleteId, d, zones);
      if (isPaceZones(zones)) return runSessionRow(planId, athleteId, d, zones);
      throw new Error('persistPlanDraft: unknown training-zone discipline');
    });
    if (rows.length) await db.insert(plannedSessions).values(rows);

    out.push({ planId, weekStart: week.weekStart });
  }

  return out;
}

/** A running planned-session row: distance @ pace (byte-identical to the legacy shape). */
function runSessionRow(planId: string, athleteId: string, d: PlannedDay, zones: PaceZones) {
  const zone = (d.zone as ZoneKey | null) ?? null;
  const range = zone ? zones.zones[zone] : null;
  return {
    planId,
    athleteId,
    discipline: 'run' as const,
    day: d.day,
    sessionType: toSessionType(d.runType, zone),
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
}

/** A cycling planned-session row: duration @ power (the distance/pace analog). */
function bikeSessionRow(planId: string, athleteId: string, d: PlannedDay, zones: PowerZones) {
  const zone = (d.zone as PowerZoneKey | null) ?? null;
  const band = zone ? zones.zones?.[zone] ?? null : null;
  return {
    planId,
    athleteId,
    discipline: 'bike' as const,
    day: d.day,
    sessionType: toSessionType(d.runType, null),
    zone: d.zone,
    targetLoad: d.targetLoadTss ?? null,
    targetDurationSeconds: d.durationSeconds ?? null,
    targetPowerLowWatts: band?.loWatts ?? null,
    targetPowerHighWatts: band?.hiWatts ?? null,
    warmup: d.warmup ?? null,
    cooldown: d.cooldown ?? null,
    segments: (d.segments ?? null) as object | null,
    description: d.description,
    pinned: d.pinned,
  };
}

/**
 * Swim runType (+ CSS zone for quality) → the schema's session_type enum. Swim's
 * five CSS-relative zones map onto the existing intensity enum (no new enum
 * values); the full swim detail (metres, sec/100 m pace targets) rides in the
 * `zone`, `segments` and metre/duration columns. Technique days (zone 'recovery')
 * land as `recovery` — a low-intensity skill swim — with the drills in segments.
 */
export function toSwimSessionType(runType: RunType, zone: SwimZoneKey | null): SessionType {
  switch (runType) {
    case 'recovery':
      return 'recovery';
    case 'easy':
    case 'maintenance':
      return 'easy';
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
        case 'vo2max':
          return 'intervals';
        case 'sprint':
          return 'tempo';
        case 'recovery': // technique / drill session
          return 'recovery';
        default:
          return 'threshold';
      }
  }
}

/**
 * A swimming planned-session row: distance-at-CSS-pace in METRES (reusing
 * `target_distance_meters`) + duration + the day's sTSS (reusing `target_load`).
 * Swim pace is sec/100 m and has no dedicated column, so the numeric pace targets
 * live in the `segments` jsonb (per-segment `targetFast/SlowSecPer100`); the
 * primary-zone key is stored in `zone` for reconstruction and querying.
 */
function swimSessionRow(planId: string, athleteId: string, d: PlannedDay, zones: SwimZones) {
  void zones; // pace bands ride in `segments` (sec/100 m has no column), not here.
  const zone = (d.zone as SwimZoneKey | null) ?? null;
  return {
    planId,
    athleteId,
    discipline: 'swim' as const,
    day: d.day,
    sessionType: toSwimSessionType(d.runType, zone),
    zone: d.zone,
    targetLoad: d.targetLoadTss ?? null,
    targetDistanceMeters: d.distanceMeters,
    targetDurationSeconds: d.durationSeconds ?? null,
    // Swim pace (sec/100 m) has no dedicated column, so the numeric pace targets
    // live in `segments` (per-segment targetFast/SlowSecPer100) rather than the
    // run's sec/km pace columns, which would mislead.
    warmup: d.warmup ?? null,
    cooldown: d.cooldown ?? null,
    segments: (d.segments ?? null) as object | null,
    description: d.description,
    pinned: d.pinned,
  };
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
