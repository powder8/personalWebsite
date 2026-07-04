/**
 * Recovery / body-readiness read model, powered by wearable data (Whoop today).
 *
 * Two jobs:
 *  1. Build a RecoverySnapshot for the "Recovery & body" card — the latest
 *     Whoop recovery score plus HRV, resting HR, and sleep, each read against
 *     the athlete's own rolling baseline (never absolute thresholds).
 *  2. Compute a LIVE readiness assessment via the pure engine (HRV/RHR/sleep
 *     z-scores + today's subjective check-in) and persist it, so the same
 *     signal flows to the hero, the autopilot guardrails, the console, and chat.
 *
 * Whoop's own recovery score is itself derived from HRV + RHR + sleep, so we
 * show it as the headline but do NOT feed it back into the engine — that would
 * double-count its own inputs. The engine consumes the raw physiology.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  hrvRecords,
  restingHrRecords,
  sleepRecords,
  dailySummaries,
  checkIns,
  readinessAssessments,
} from '@/db/schema';
import {
  addDays,
  computeBaseline,
  assessReadiness,
  type DailyReading,
  type ReadinessResult,
} from '@/engine';

const LOOKBACK_DAYS = 60;

export type Trend = 'good' | 'watch' | 'low' | 'neutral';

export interface RecoverySnapshot {
  asOf: string | null; // most recent day with any wearable data
  recoveryScore: number | null; // Whoop 0-100
  recoveryBand: 'green' | 'yellow' | 'red' | null;
  hrvMs: number | null;
  hrvZ: number | null;
  hrvTrend: Trend;
  restingHr: number | null;
  restingHrZ: number | null;
  restingHrTrend: Trend;
  sleepHours: number | null;
  sleepPerfPct: number | null;
  deepMin: number | null;
  remMin: number | null;
  sleepTrend: Trend;
  hrvSeries: { day: string; value: number }[]; // last 14 days, oldest→newest
  restingHrSeries: { day: string; value: number }[];
  n: number; // days of HRV history in the long window
}

export interface RecoveryInsights {
  hasData: boolean;
  snapshot: RecoverySnapshot;
  readiness: ReadinessResult | null;
}

const EMPTY_SNAPSHOT: RecoverySnapshot = {
  asOf: null,
  recoveryScore: null,
  recoveryBand: null,
  hrvMs: null,
  hrvZ: null,
  hrvTrend: 'neutral',
  restingHr: null,
  restingHrZ: null,
  restingHrTrend: 'neutral',
  sleepHours: null,
  sleepPerfPct: null,
  deepMin: null,
  remMin: null,
  sleepTrend: 'neutral',
  hrvSeries: [],
  restingHrSeries: [],
  n: 0,
};

/** HRV / sleep: higher is better. Resting HR passes `invert` to flip it. */
function trendFromZ(z: number | null, invert = false): Trend {
  if (z == null) return 'neutral';
  const v = invert ? -z : z;
  if (v >= -0.5) return 'good';
  if (v >= -1) return 'watch';
  return 'low';
}

function lastN<T extends { day: string }>(rows: T[], n: number): T[] {
  return [...rows].sort((a, b) => a.day.localeCompare(b.day)).slice(-n);
}

export async function getRecoveryInsights(
  db: DB,
  athleteId: string,
  today: string,
): Promise<RecoveryInsights> {
  const cutoff = addDays(today, -LOOKBACK_DAYS);

  const [hrvRows, rhrRows, sleepRows, summaryRows, recentChecks] = await Promise.all([
    db
      .select({ day: hrvRecords.day, ms: hrvRecords.overnightAvgMs })
      .from(hrvRecords)
      .where(and(eq(hrvRecords.athleteId, athleteId), gte(hrvRecords.day, cutoff))),
    db
      .select({ day: restingHrRecords.day, hr: restingHrRecords.restingHr })
      .from(restingHrRecords)
      .where(and(eq(restingHrRecords.athleteId, athleteId), gte(restingHrRecords.day, cutoff))),
    db
      .select({
        day: sleepRecords.day,
        total: sleepRecords.totalSleepSeconds,
        deep: sleepRecords.deepSeconds,
        rem: sleepRecords.remSeconds,
        score: sleepRecords.sleepScore,
      })
      .from(sleepRecords)
      .where(and(eq(sleepRecords.athleteId, athleteId), gte(sleepRecords.day, cutoff))),
    db
      .select({ day: dailySummaries.day, metrics: dailySummaries.metrics })
      .from(dailySummaries)
      .where(and(eq(dailySummaries.athleteId, athleteId), gte(dailySummaries.day, cutoff))),
    db
      .select({
        day: checkIns.day,
        soreness: checkIns.soreness,
        energy: checkIns.energy,
        yesterdayRpe: checkIns.yesterdayRpe,
      })
      .from(checkIns)
      .where(and(eq(checkIns.athleteId, athleteId), gte(checkIns.day, cutoff))),
  ]);

  const hasData = hrvRows.length > 0 || rhrRows.length > 0 || sleepRows.length > 0;
  if (!hasData) return { hasData: false, snapshot: EMPTY_SNAPSHOT, readiness: null };

  // Readings for the engine (drop nulls).
  const hrv: DailyReading[] = hrvRows.filter((r) => r.ms != null).map((r) => ({ day: r.day, value: r.ms! }));
  const rhr: DailyReading[] = rhrRows.map((r) => ({ day: r.day, value: r.hr }));
  const sleepHrs: DailyReading[] = sleepRows
    .filter((r) => r.total != null)
    .map((r) => ({ day: r.day, value: r.total! / 3600 }));

  const hrvBase = computeBaseline(hrv, today);
  const rhrBase = computeBaseline(rhr, today);
  const sleepBase = computeBaseline(sleepHrs, today);

  // Latest sleep row (by day) for the last-night detail.
  const latestSleep = [...sleepRows].sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;

  // Latest Whoop recovery score from daily summaries' metrics blob.
  const summariesByDay = [...summaryRows].sort((a, b) => b.day.localeCompare(a.day));
  let recoveryScore: number | null = null;
  for (const s of summariesByDay) {
    const m = s.metrics as Record<string, number | null> | null;
    const rs = m?.recovery_score;
    if (rs != null) {
      recoveryScore = Math.round(rs);
      break;
    }
  }
  const recoveryBand =
    recoveryScore == null ? null : recoveryScore >= 67 ? 'green' : recoveryScore >= 34 ? 'yellow' : 'red';

  // Most recent day across signals = the snapshot "as of".
  const allDays = [...hrv, ...rhr, ...sleepHrs].map((r) => r.day);
  const asOf = allDays.length ? allDays.sort().at(-1)! : null;

  const snapshot: RecoverySnapshot = {
    asOf,
    recoveryScore,
    recoveryBand,
    hrvMs: hrvBase.latestValue != null ? Math.round(hrvBase.latestValue) : null,
    hrvZ: hrvBase.latestZ,
    hrvTrend: trendFromZ(hrvBase.latestZ),
    restingHr: rhrBase.latestValue != null ? Math.round(rhrBase.latestValue) : null,
    restingHrZ: rhrBase.latestZ,
    restingHrTrend: trendFromZ(rhrBase.latestZ, true), // higher RHR = worse
    sleepHours: latestSleep?.total != null ? Math.round((latestSleep.total / 3600) * 10) / 10 : null,
    sleepPerfPct: latestSleep?.score ?? null,
    deepMin: latestSleep?.deep != null ? Math.round(latestSleep.deep / 60) : null,
    remMin: latestSleep?.rem != null ? Math.round(latestSleep.rem / 60) : null,
    sleepTrend: trendFromZ(sleepBase.latestZ),
    hrvSeries: lastN(hrv, 14),
    restingHrSeries: lastN(rhr, 14),
    n: hrvBase.n,
  };

  // --- Live readiness via the pure engine ---
  const todayCheck = recentChecks.find((c) => c.day === today) ?? null;
  const readiness = assessReadiness({
    day: today,
    hrvZ: hrvBase.latestZ,
    restingHrZ: rhrBase.latestZ,
    sleepZ: sleepBase.latestZ,
    soreness: todayCheck?.soreness ?? null,
    energy: todayCheck?.energy ?? null,
    yesterdayRpe: todayCheck?.yesterdayRpe ?? null,
  });

  return { hasData: true, snapshot, readiness };
}

/**
 * Persist today's live readiness so downstream consumers (hero fallback,
 * autopilot guardrails, console, chat) see it. Idempotent per (athlete, day);
 * leaves any coach grade untouched.
 */
export async function persistReadiness(
  db: DB,
  athleteId: string,
  result: ReadinessResult,
): Promise<void> {
  await db
    .insert(readinessAssessments)
    .values({
      athleteId,
      day: result.day,
      score: result.score,
      band: result.band,
      sentence: result.sentence,
      drivers: result.drivers as unknown as object,
    })
    .onConflictDoUpdate({
      target: [readinessAssessments.athleteId, readinessAssessments.day],
      set: {
        score: result.score,
        band: result.band,
        sentence: result.sentence,
        drivers: result.drivers as unknown as object,
      },
    });
}
