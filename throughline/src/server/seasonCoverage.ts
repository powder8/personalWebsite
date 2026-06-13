import 'server-only';
/**
 * Guarantee that an athlete with a live plan never faces an empty CURRENT week.
 *
 * Two failure modes this heals (idempotent, safe to call on portal load):
 *  1. Plan stuck in DRAFT — assisted-mode weeks roll forward as drafts awaiting
 *     coach approval; the week the athlete is living in must be PUBLISHED. We
 *     publish a rolling horizon (current + next week), leaving further weeks as
 *     drafts for the coach.
 *  2. NO plan at all — a goal race exists but nothing was ever generated. If we
 *     have a fitness anchor, regenerate the season from today → race.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { races, plans } from '@/db/schema';
import { getAthleteZones } from '@/db/paceConfig';
import { getTrainingInsights } from '@/server/insights';
import { setupSeason } from '@/server/season';
import { selectDueDraftWeeks, isDayCovered, type PlanWeekRef } from '@/server/coverageLogic';

export interface CoverageResult {
  status: 'no_goal' | 'no_fitness' | 'covered' | 'updated';
  generated: boolean;
  published: number;
}

async function planRefs(db: DB, athleteId: string): Promise<PlanWeekRef[]> {
  const rows = await db
    .select({ id: plans.id, status: plans.status, weekStart: plans.weekStart, weekEnd: plans.weekEnd })
    .from(plans)
    .where(eq(plans.athleteId, athleteId));
  return rows as PlanWeekRef[];
}

export async function ensureSeasonCoverage(db: DB, athleteId: string, today: string): Promise<CoverageResult> {
  let refs = await planRefs(db, athleteId);
  const [goal] = await db.select().from(races).where(and(eq(races.athleteId, athleteId), eq(races.priority, 'goal'))).limit(1);
  const hasFutureGoal = !!goal && goal.date >= today;

  let generated = false;
  // (2) Goaled athlete with NOTHING covering today → regenerate from fitness.
  if (hasFutureGoal && !isDayCovered(refs, today)) {
    const zones = await getAthleteZones(db, athleteId);
    if (!zones) return { status: 'no_fitness', generated: false, published: 0 };

    const allRaces = await db.select().from(races).where(eq(races.athleteId, athleteId));
    const insights = await getTrainingInsights(athleteId);
    const recentMiles = insights?.recent?.avgWeeklyMiles ?? insights?.buildProfile?.medianWeeklyMiles ?? 20;
    const startVolumeMiles = Math.max(12, Math.round(recentMiles));
    const peakVolumeMiles = Math.max(startVolumeMiles + 8, Math.round(recentMiles * 1.4));

    await setupSeason(db, athleteId, {
      startDay: today,
      goalRace: {
        name: goal!.name,
        date: goal!.date,
        distanceLabel: goal!.distanceLabel ?? undefined,
        distanceMeters: goal!.distanceMeters ?? undefined,
        goalType: (goal!.goalType as 'time' | 'pace' | 'effort' | 'none') ?? 'none',
        targetTimeSeconds: goal!.targetTimeSeconds ?? undefined,
      },
      keyRaces: allRaces
        .filter((r) => r.priority !== 'goal')
        .map((r) => ({
          name: r.name,
          date: r.date,
          distanceLabel: r.distanceLabel ?? undefined,
          distanceMeters: r.distanceMeters ?? undefined,
          purpose: r.purpose ?? undefined,
          goalType: (r.goalType as 'time' | 'pace' | 'effort' | 'none') ?? 'none',
          targetTimeSeconds: r.targetTimeSeconds ?? undefined,
        })),
      startVolumeMiles,
      peakVolumeMiles,
      publish: false, // generated as drafts; the horizon below publishes the current weeks
    });
    generated = true;
    refs = await planRefs(db, athleteId);
  }

  // (1) Roll the publish horizon: publish current + next draft week for anyone.
  const due = selectDueDraftWeeks(refs, today);
  if (due.length) {
    await db.update(plans).set({ status: 'published', publishedAt: new Date() }).where(inArray(plans.id, due));
  }

  if (generated || due.length) return { status: 'updated', generated, published: due.length };
  if (!goal || !hasFutureGoal) return { status: 'no_goal', generated: false, published: 0 };
  return { status: 'covered', generated: false, published: 0 };
}
