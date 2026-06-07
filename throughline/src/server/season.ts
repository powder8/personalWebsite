/**
 * Season setup: take a coach's inputs (goal race, key races, fitness anchor,
 * volume) and produce a persisted, race-aware plan — then read it back for the
 * season view. Idempotent: re-running replaces the athlete's races + plan.
 *
 * db is passed in so this works against Neon, local PGlite, and tests.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, races, plans } from '@/db/schema';
import {
  generatePlan,
  resolvePaceZones,
  type AthletePaceConfig,
  type KeyRace,
} from '@/engine/plan';
import { persistPlanDraft } from '@/db/plans';
import { getGlobalPaceModel, setAthletePaceConfig } from '@/db/paceConfig';

export interface SeasonRaceInput {
  name: string;
  date: string; // YYYY-MM-DD
  distanceLabel?: string;
  distanceMeters?: number;
  priority: 'goal' | 'tune_up' | 'training';
  goalType?: 'time' | 'pace' | 'effort' | 'none';
  targetTimeSeconds?: number;
  targetPaceSecPerKm?: number;
}

export interface SeasonSetupInput {
  startDay: string; // build start (caller passes "today")
  goalRace: SeasonRaceInput; // priority forced to 'goal'
  keyRaces?: SeasonRaceInput[];
  /** Fitness anchor: a recent race (preferred) or a threshold pace. */
  fitness: { race?: { distanceMeters: number; timeSeconds: number }; thresholdSecPerKm?: number };
  startVolumeMiles: number;
  peakVolumeMiles: number;
}

export interface SeasonSetupResult {
  weeks: number;
  raceCount: number;
}

export async function setupSeason(
  db: DB,
  athleteId: string,
  input: SeasonSetupInput,
): Promise<SeasonSetupResult> {
  // 1) Fitness anchor → pace config (persisted for reuse) → zones.
  const cfg: AthletePaceConfig = input.fitness.race
    ? { kind: 'vdot', race: input.fitness.race }
    : { thresholdSecPerKm: input.fitness.thresholdSecPerKm };
  const global = await getGlobalPaceModel(db);
  const zones = resolvePaceZones(cfg, global);
  await setAthletePaceConfig(db, athleteId, cfg);

  // 2) Athlete goal summary (for the roster).
  await db
    .update(athletes)
    .set({ goalRace: input.goalRace.name, goalRaceDate: input.goalRace.date, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));

  // 3) Replace races (goal + key races).
  const allRaces: SeasonRaceInput[] = [
    { ...input.goalRace, priority: 'goal' },
    ...(input.keyRaces ?? []),
  ];
  await db.delete(races).where(eq(races.athleteId, athleteId));
  await db.insert(races).values(
    allRaces.map((r) => ({
      athleteId,
      name: r.name,
      date: r.date,
      distanceLabel: r.distanceLabel ?? null,
      distanceMeters: r.distanceMeters ?? null,
      priority: r.priority,
      goalType: r.goalType ?? 'none',
      targetTimeSeconds: r.targetTimeSeconds ?? null,
      targetPaceSecPerKm: r.targetPaceSecPerKm ?? null,
    })),
  );

  // 4) Regenerate the race-aware plan from scratch.
  const keyRaces: KeyRace[] = allRaces.map((r) => ({
    date: r.date,
    priority: r.priority,
    label: r.name,
  }));
  await db.delete(plans).where(eq(plans.athleteId, athleteId)); // cascades planned_sessions
  const weeks = generatePlan(
    {
      startDay: input.startDay,
      goalRaceDay: input.goalRace.date,
      startVolumeMiles: input.startVolumeMiles,
      peakVolumeMiles: input.peakVolumeMiles,
      keyRaces,
    },
    zones,
  );
  await persistPlanDraft(db, athleteId, weeks, zones, { setupAt: input.startDay });

  return { weeks: weeks.length, raceCount: allRaces.length };
}

export interface SeasonWeek {
  weekStart: string;
  weekEnd: string;
  phase: string | null;
  cycle: number | null;
  weeklyTargetMeters: number | null;
  rationale: string | null;
}

export async function getSeasonPlan(
  db: DB,
  athleteId: string,
): Promise<{ weeks: SeasonWeek[]; races: typeof races.$inferSelect[] }> {
  const weekRows = await db
    .select({
      weekStart: plans.weekStart,
      weekEnd: plans.weekEnd,
      phase: plans.phase,
      cycle: plans.cycle,
      weeklyTargetMeters: plans.weeklyTargetMeters,
      rationale: plans.rationale,
    })
    .from(plans)
    .where(eq(plans.athleteId, athleteId))
    .orderBy(plans.weekStart);
  const raceRows = await db.select().from(races).where(eq(races.athleteId, athleteId)).orderBy(races.date);
  return { weeks: weekRows, races: raceRows };
}
