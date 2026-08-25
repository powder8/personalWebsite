import 'server-only';
/**
 * Server-only assembly of an athlete's general Health snapshot for
 * `/me/[id]/health`. READ-ONLY, sport-agnostic, and derived entirely from
 * tables that already exist (no migration): VDOT from `athletes.paceConfig`,
 * wearable signals via the existing recovery read model, sleep from
 * `sleep_records`, and an activity mix across every sport in `activities`.
 *
 * All the number-crunching lives in the pure `healthLogic.ts`; this file only
 * fetches and stitches. Body composition (weight/BMI) has no data source in v1
 * — persistence is DEFERRED — so its fields are null and the UI shows a stub.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, sleepRecords, activities, dailySummaries } from '@/db/schema';
import { getAthleteVdot } from '@/db/paceConfig';
import { ageFromDob } from '@/engine/plan';
import { addDays } from '@/engine';
import { getRecoveryInsights, type RecoverySnapshot } from '@/server/recovery';
import type { ReadinessResult } from '@/engine';
import {
  normalizeSex,
  vo2maxFromVdot,
  percentileForVo2max,
  fitnessAgeForVo2max,
  categoryForPercentile,
  restingHrContext,
  sleepAssessment,
  meanStd,
  type Sex,
  type FitnessCategory,
  type RestingHrContext,
  type SleepAssessment,
} from '@/server/healthLogic';

const SLEEP_WINDOW_DAYS = 14;
const ACTIVITY_WINDOW_DAYS = 90;

export interface CardioHealth {
  vdot: number | null;
  vo2max: number | null;
  /** Where the VO2max came from — v1 only ever estimates from VDOT. */
  vo2maxSource: 'provider' | 'estimated_vdot' | null;
  percentile: number | null;
  fitnessAge: number | null;
  category: FitnessCategory | null;
}

export interface SleepHealth {
  avgHours: number | null;
  stdHours: number | null;
  nights: number;
  latestHours: number | null;
  assessment: SleepAssessment | null;
}

export interface BodyHealth {
  /** All null in v1 — weight persistence is deferred (no column, no source). */
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  bmiCategory: string | null;
  persistenceDeferred: true;
}

export interface HealthSnapshot {
  age: number | null;
  sex: Sex | null;
  cardio: CardioHealth;
  recovery: RecoverySnapshot;
  readiness: ReadinessResult | null;
  restingHrContext: RestingHrContext | null;
  sleep: SleepHealth;
  body: BodyHealth;
  /** Activity mix across all sports in the last 90 days (drives the header). */
  sports: { sport: string; count: number }[];
  /** Daily steps (avg over the window) from any wearable — null if none logged. */
  steps: { avgPerDay: number; days: number } | null;
  hasWearable: boolean;
}

/**
 * Assemble the whole Health snapshot. Every metric degrades gracefully: a
 * runner with no wearable still gets cardio; a walker with a Whoop but no VDOT
 * still gets recovery and sleep.
 */
export async function getHealthSnapshot(
  db: DB,
  athleteId: string,
  today: string,
): Promise<HealthSnapshot | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;

  const sex = normalizeSex(athlete.sex);
  const age = ageFromDob(athlete.dateOfBirth, today);

  const sleepCutoff = addDays(today, -SLEEP_WINDOW_DAYS);
  const activityCutoff = addDays(today, -ACTIVITY_WINDOW_DAYS);

  const [vdot, recovery, sleepRows, sportRows, stepRows] = await Promise.all([
    getAthleteVdot(db, athleteId),
    getRecoveryInsights(db, athleteId, today),
    db
      .select({ day: sleepRecords.day, total: sleepRecords.totalSleepSeconds })
      .from(sleepRecords)
      .where(and(eq(sleepRecords.athleteId, athleteId), gte(sleepRecords.day, sleepCutoff))),
    db
      .select({ sport: activities.sport, count: sql<number>`count(*)::int` })
      .from(activities)
      .where(
        and(
          eq(activities.athleteId, athleteId),
          gte(activities.startTime, new Date(`${activityCutoff}T00:00:00Z`)),
        ),
      )
      .groupBy(activities.sport),
    db
      .select({ day: dailySummaries.day, steps: dailySummaries.steps })
      .from(dailySummaries)
      .where(and(eq(dailySummaries.athleteId, athleteId), gte(dailySummaries.day, sleepCutoff))),
  ]);

  // ── Steps (avg/day over the window, from any wearable) ──
  const stepVals = stepRows.map((r) => r.steps).filter((s): s is number => s != null && s > 0);
  const steps =
    stepVals.length > 0
      ? { avgPerDay: Math.round(stepVals.reduce((a, b) => a + b, 0) / stepVals.length), days: stepVals.length }
      : null;

  // ── Cardio (VDOT → estimated VO2max → percentile + fitness age) ──
  const vo2max = vo2maxFromVdot(vdot);
  const percentile = percentileForVo2max(vo2max, sex, age);
  const cardio: CardioHealth = {
    vdot: vdot != null ? Math.round(vdot * 10) / 10 : null,
    vo2max,
    vo2maxSource: vo2max != null ? 'estimated_vdot' : null,
    percentile,
    fitnessAge: fitnessAgeForVo2max(vo2max, sex),
    category: categoryForPercentile(percentile),
  };

  // ── Sleep (avg + consistency over the window vs the 7-9h guideline) ──
  const sleepHoursList = sleepRows
    .filter((r) => r.total != null)
    .map((r) => (r.total as number) / 3600);
  const { mean: avgHours, std: stdHours, n: nights } = meanStd(sleepHoursList);
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const sleep: SleepHealth = {
    avgHours: round1(avgHours),
    stdHours: round1(stdHours),
    nights,
    latestHours: recovery.snapshot.sleepHours,
    assessment: sleepAssessment(avgHours, stdHours),
  };

  const sports = sportRows
    .map((r) => ({ sport: r.sport as string, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);

  return {
    age,
    sex,
    cardio,
    recovery: recovery.snapshot,
    readiness: recovery.readiness,
    restingHrContext: restingHrContext(recovery.snapshot.restingHr),
    sleep,
    body: {
      weightKg: null,
      heightCm: null,
      bmi: null,
      bmiCategory: null,
      persistenceDeferred: true,
    },
    sports,
    steps,
    hasWearable: recovery.hasData,
  };
}
