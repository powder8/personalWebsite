/**
 * Season setup: take a coach's inputs (goal race, key races, fitness anchor,
 * volume) and produce a persisted, race-aware plan — then read it back for the
 * season view. Idempotent: re-running replaces the athlete's races + plan.
 *
 * db is passed in so this works against Neon, local PGlite, and tests.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, races, plans, plannedSessions } from '@/db/schema';
import {
  generatePlan,
  classifyGoal,
  resolvePaceZones,
  purposeToPriority,
  type AthletePaceConfig,
  type KeyRace,
} from '@/engine/plan';
import { persistPlanDraft } from '@/db/plans';
import { getGlobalPaceModel, setAthletePaceConfig, getAthleteZones } from '@/db/paceConfig';

export interface SeasonRaceInput {
  name: string;
  date: string; // YYYY-MM-DD
  distanceLabel?: string;
  distanceMeters?: number;
  /** Engine taper class. Derived from `purpose` for key races; forced 'goal' for the goal race. */
  priority?: 'goal' | 'tune_up' | 'training';
  /** Coach-facing reason (rust-buster, sharpening, …); drives `priority`. */
  purpose?: string;
  goalType?: 'time' | 'pace' | 'effort' | 'none';
  targetTimeSeconds?: number;
  targetPaceSecPerKm?: number;
}

export interface SeasonSetupInput {
  startDay: string; // build start (caller passes "today")
  goalRace: SeasonRaceInput; // priority forced to 'goal'
  keyRaces?: SeasonRaceInput[];
  /**
   * Fitness anchor: a recent race (preferred) or a threshold pace. Optional —
   * omit to keep the athlete's EXISTING anchor (e.g. an auto-detected one from
   * Strava) and just (re)build the plan around the new goal.
   */
  fitness?: { race?: { distanceMeters: number; timeSeconds: number }; thresholdSecPerKm?: number };
  startVolumeMiles: number;
  peakVolumeMiles: number;
  /** Publish all weeks immediately (athlete self-service) instead of leaving drafts for coach review. */
  publish?: boolean;
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
  // 1) Fitness anchor → pace config (persisted for reuse) → zones. If no fitness
  //    is supplied, keep the athlete's existing anchor and use its zones.
  const global = await getGlobalPaceModel(db);
  let zones;
  if (input.fitness && (input.fitness.race || input.fitness.thresholdSecPerKm != null)) {
    const cfg: AthletePaceConfig = input.fitness.race
      ? { kind: 'vdot', race: input.fitness.race }
      : { thresholdSecPerKm: input.fitness.thresholdSecPerKm };
    zones = resolvePaceZones(cfg, global);
    await setAthletePaceConfig(db, athleteId, cfg);
  } else {
    zones = await getAthleteZones(db, athleteId);
    if (!zones) throw new Error('No fitness anchor yet, provide a recent race or pace.');
  }

  // 2) Athlete goal summary (for the roster).
  await db
    .update(athletes)
    .set({ goalRace: input.goalRace.name, goalRaceDate: input.goalRace.date, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));

  // 3) Replace races (goal + key races). Each key race carries a `purpose`; the
  //    engine `priority` (taper behavior) is derived from it.
  const allRaces: (SeasonRaceInput & { priority: 'goal' | 'tune_up' | 'training' })[] = [
    { ...input.goalRace, priority: 'goal', purpose: 'goal' },
    ...(input.keyRaces ?? []).map((r) => ({ ...r, priority: purposeToPriority(r.purpose) })),
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
      purpose: r.purpose ?? null,
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
      goalClass: classifyGoal({ date: input.goalRace.date, distanceMeters: input.goalRace.distanceMeters, distanceLabel: input.goalRace.distanceLabel }),
      startVolumeMiles: input.startVolumeMiles,
      peakVolumeMiles: input.peakVolumeMiles,
      keyRaces,
    },
    zones,
  );
  await persistPlanDraft(db, athleteId, weeks, zones, { setupAt: input.startDay }, { status: input.publish ? 'published' : 'draft' });

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

export interface UpcomingWeek {
  planId: string;
  weekStart: string;
  weekEnd: string;
  phase: string | null;
  cycle: number | null;
  status: string;
  weeklyTargetMeters: number | null;
  rationale: string | null;
  sessions: typeof plannedSessions.$inferSelect[];
}

/**
 * The current and next `count` weeks, with their day-by-day sessions — the
 * "look a few weeks ahead" view. Prefers the published plan for a week, falling
 * back to the draft; skips superseded.
 */
export async function getUpcomingWeeks(
  db: DB,
  athleteId: string,
  today: string,
  count = 4,
): Promise<UpcomingWeek[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), gte(plans.weekEnd, today)))
    .orderBy(plans.weekStart);

  // One plan per week: prefer published, else draft (ignore superseded).
  const byWeek = new Map<string, typeof plans.$inferSelect>();
  for (const p of rows) {
    if (p.status === 'superseded') continue;
    const existing = byWeek.get(p.weekStart);
    if (!existing || (p.status === 'published' && existing.status !== 'published')) {
      byWeek.set(p.weekStart, p);
    }
  }

  const chosen = Array.from(byWeek.values())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(0, count);

  const out: UpcomingWeek[] = [];
  for (const p of chosen) {
    const sessions = await db
      .select()
      .from(plannedSessions)
      .where(eq(plannedSessions.planId, p.id))
      .orderBy(plannedSessions.day);
    out.push({
      planId: p.id,
      weekStart: p.weekStart,
      weekEnd: p.weekEnd,
      phase: p.phase,
      cycle: p.cycle,
      status: p.status,
      weeklyTargetMeters: p.weeklyTargetMeters,
      rationale: p.rationale,
      sessions,
    });
  }
  return out;
}
