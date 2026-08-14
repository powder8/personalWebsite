/**
 * Triathlon season setup — the minimal `'tri'` goal path (spec §8, task item 3).
 *
 * Takes a triathlete's realistic weekly HOURS, a target race (70.3 / half-iron),
 * and a self-reported limiter, and produces a persisted multi-sport plan: the
 * time-budget allocator splits the hours across swim/bike/run, each sport rides
 * the shared periodize+generate pipeline, and the three discipline-tagged weeks
 * are persisted via the existing `persistPlanDraft` (one plans row per sport per
 * week — no new schema, no migration). The portal already renders discipline-
 * tagged sessions.
 *
 * Requires the athlete to already carry the three fitness anchors (VDOT / FTP /
 * CSS) so their zones resolve — same "anchor first" contract as `setupSeason`.
 *
 * `db` is passed in so this works against Neon, local PGlite, and tests.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, races, plans } from '@/db/schema';
import { persistPlanDraft } from '@/db/plans';
import { getAthleteZones } from '@/db/paceConfig';
import { getAthletePowerZones } from '@/db/powerConfig';
import { getAthleteSwimZones } from '@/db/swimConfig';
import {
  buildTriPlan,
  TRI_DISCIPLINES,
  type Discipline,
  type TrainingZones,
  type TriDistance,
} from '@/engine/plan';

export interface TriSeasonSetupInput {
  startDay: string; // build start (caller passes "today")
  goalRace: { name: string; date: string; distance: TriDistance; distanceMeters?: number };
  /** Realistic weekly training HOURS budget — the first-class input. */
  weeklyHours: number;
  /** Self-reported weakest sport. */
  limiter: Discipline;
  /** Publish immediately (athlete self-service) instead of leaving drafts. */
  publish?: boolean;
}

export interface TriSeasonSetupResult {
  weeksPerSport: number;
  budgets: Record<Discipline, { hours: number; tss: number }>;
  totalTss: number;
}

/**
 * Resolve the athlete's three sets of training zones. Throws if any anchor is
 * missing — a triathlon plan needs all three (mirrors `setupSeason`'s contract).
 */
async function resolveTriZones(db: DB, athleteId: string): Promise<Record<Discipline, TrainingZones>> {
  const [run, bike, swim] = await Promise.all([
    getAthleteZones(db, athleteId),
    getAthletePowerZones(db, athleteId),
    getAthleteSwimZones(db, athleteId),
  ]);
  const missing: string[] = [];
  if (!run) missing.push('run (VDOT/threshold pace)');
  if (!bike) missing.push('bike (FTP)');
  if (!swim) missing.push('swim (CSS)');
  if (missing.length) {
    throw new Error(`Triathlon plan needs all three anchors — missing: ${missing.join(', ')}.`);
  }
  return { run: run!, bike: bike!, swim: swim! };
}

export async function setupTriSeason(
  db: DB,
  athleteId: string,
  input: TriSeasonSetupInput,
): Promise<TriSeasonSetupResult> {
  const zones = await resolveTriZones(db, athleteId);

  const plan = buildTriPlan({
    startDay: input.startDay,
    goalRaceDay: input.goalRace.date,
    distance: input.goalRace.distance,
    weeklyHours: input.weeklyHours,
    limiter: input.limiter,
    zones,
  });

  // Athlete goal summary (for the roster).
  await db
    .update(athletes)
    .set({ goalRace: input.goalRace.name, goalRaceDate: input.goalRace.date, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));

  // Replace races with the single goal race.
  await db.delete(races).where(eq(races.athleteId, athleteId));
  await db.insert(races).values({
    athleteId,
    name: input.goalRace.name,
    date: input.goalRace.date,
    distanceLabel: input.goalRace.distance,
    distanceMeters: input.goalRace.distanceMeters ?? null,
    priority: 'goal',
    purpose: 'goal',
    goalType: 'none',
  });

  // Regenerate: clear all plans, then persist one discipline-tagged plan per sport
  // per week. `persistPlanDraft` infers the discipline from the zones arm.
  await db.delete(plans).where(eq(plans.athleteId, athleteId)); // cascades planned_sessions
  const status = input.publish ? ('published' as const) : ('draft' as const);
  for (const d of TRI_DISCIPLINES) {
    await persistPlanDraft(
      db,
      athleteId,
      plan.perSport[d],
      zones[d],
      { setupAt: input.startDay, tri: true, discipline: d, weeklyHours: input.weeklyHours },
      { status },
    );
  }

  const budgets = {} as Record<Discipline, { hours: number; tss: number }>;
  for (const d of TRI_DISCIPLINES) {
    budgets[d] = { hours: plan.allocation.budgets[d].hours, tss: plan.allocation.budgets[d].tss };
  }

  return {
    weeksPerSport: plan.perSport.bike.length,
    budgets,
    totalTss: plan.allocation.totalTss,
  };
}
