import 'server-only';
/**
 * Guarantee that an athlete relying on the app for ALL guidance never faces an
 * empty current week. Idempotent; safe to call on every portal load.
 *
 * Heals every realistic cause:
 *  1. Plan stuck in DRAFT (assisted mode) — publish a rolling horizon so the
 *     current week is visible. Autonomous athletes (no human coach) get the
 *     whole plan published.
 *  2. NO plan at all — regenerate from today → goal. The goal can come from a
 *     `races` goal row OR just the athlete's goal summary; the anchor is
 *     auto-derived from recent runs if one isn't set yet.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, races, plans } from '@/db/schema';
import { getAthleteZones } from '@/db/paceConfig';
import { getTrainingInsights } from '@/server/insights';
import { ensureAutoAnchor } from '@/server/anchor';
import { setupSeason, type SeasonRaceInput } from '@/server/season';
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

/** Best-guess race distance from a free-text goal name (summary fallback). */
function inferGoalDistance(name: string): { distanceLabel?: string; distanceMeters?: number } {
  const n = name.toLowerCase();
  if (/marathon/.test(n) && !/half/.test(n)) return { distanceLabel: 'Marathon', distanceMeters: 42195 };
  if (/half/.test(n)) return { distanceLabel: 'Half', distanceMeters: 21097 };
  if (/10\s?k/.test(n)) return { distanceLabel: '10K', distanceMeters: 10000 };
  if (/5\s?k|parkrun/.test(n)) return { distanceLabel: '5K', distanceMeters: 5000 };
  return {}; // unknown → planner defaults to a half-ish build
}

export async function ensureSeasonCoverage(db: DB, athleteId: string, today: string): Promise<CoverageResult> {
  let refs = await planRefs(db, athleteId);
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return { status: 'no_goal', generated: false, published: 0 };

  // Goal can come from a goal-race row OR the athlete's goal summary (some flows
  // set only the summary). Either is enough to build a plan toward.
  const [goalRow] = await db
    .select()
    .from(races)
    .where(and(eq(races.athleteId, athleteId), eq(races.priority, 'goal')))
    .limit(1);
  const summaryGoal =
    !goalRow && athlete.goalRace && athlete.goalRaceDate && athlete.goalRaceDate >= today
      ? { name: athlete.goalRace, date: athlete.goalRaceDate, ...inferGoalDistance(athlete.goalRace) }
      : null;
  const goal = goalRow && goalRow.date >= today ? goalRow : null;
  const hasFutureGoal = !!goal || !!summaryGoal;

  let generated = false;
  // Regenerate when a goaled athlete has NOTHING covering today.
  if (hasFutureGoal && !isDayCovered(refs, today)) {
    // Derive a fitness anchor from recent runs if one isn't set (so an athlete
    // who just logs/syncs runs gets a plan without manually entering fitness).
    let zones = await getAthleteZones(db, athleteId);
    if (!zones) {
      await ensureAutoAnchor(db, athleteId, { today });
      zones = await getAthleteZones(db, athleteId);
    }
    if (!zones) return { status: 'no_fitness', generated: false, published: 0 };

    const allRaces = await db.select().from(races).where(eq(races.athleteId, athleteId));
    const insights = await getTrainingInsights(athleteId);
    const recentMiles = insights?.recent?.avgWeeklyMiles ?? insights?.buildProfile?.medianWeeklyMiles ?? 20;
    const startVolumeMiles = Math.max(12, Math.round(recentMiles));
    const peakVolumeMiles = Math.max(startVolumeMiles + 8, Math.round(recentMiles * 1.4));

    const goalRace: SeasonRaceInput = goal
      ? {
          name: goal.name,
          date: goal.date,
          distanceLabel: goal.distanceLabel ?? undefined,
          distanceMeters: goal.distanceMeters ?? undefined,
          goalType: (goal.goalType as 'time' | 'pace' | 'effort' | 'none') ?? 'none',
          targetTimeSeconds: goal.targetTimeSeconds ?? undefined,
        }
      : { name: summaryGoal!.name, date: summaryGoal!.date, distanceLabel: summaryGoal!.distanceLabel, distanceMeters: summaryGoal!.distanceMeters, goalType: 'none' };

    await setupSeason(db, athleteId, {
      startDay: today,
      goalRace,
      keyRaces: allRaces
        .filter((r) => r.priority !== 'goal' && r.id !== goal?.id)
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
      publish: false, // the horizon below decides what to publish
    });
    generated = true;
    refs = await planRefs(db, athleteId);
  }

  // Publish: autonomous athletes (no human coach) get the whole plan; assisted
  // athletes get a rolling horizon (current + next week) and keep the rest as
  // drafts for the coach.
  const autonomous = athlete.coachingMode === 'autonomous';
  const due = autonomous
    ? refs.filter((p) => p.status === 'draft' && p.weekEnd >= today).map((p) => p.id)
    : selectDueDraftWeeks(refs, today);
  if (due.length) {
    await db.update(plans).set({ status: 'published', publishedAt: new Date() }).where(inArray(plans.id, due));
  }

  if (generated || due.length) return { status: 'updated', generated, published: due.length };
  if (!hasFutureGoal) return { status: 'no_goal', generated: false, published: 0 };
  return { status: 'covered', generated: false, published: 0 };
}
