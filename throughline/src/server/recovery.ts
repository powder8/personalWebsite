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
import { and, eq, gte, lte } from 'drizzle-orm';
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
  assessReadiness,
  type DailyReading,
  type ReadinessResult,
} from '@/engine';

import { currentSignal, recoveryPattern, recoveryFocus, type RecoveryPattern } from './recoveryLogic';

const LOOKBACK_DAYS = 60;

export type Trend = 'good' | 'watch' | 'low' | 'neutral';

export interface RecoverySnapshot {
  signalDays: { hrv: string | null; restingHr: string | null; sleep: string | null; recovery: string | null };
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
  // Secondary markers — shown behind an expander (early-illness / strain signals).
  respiratoryRate: number | null; // breaths/min, last night
  skinTempCelsius: number | null; // overnight skin temp deviation baseline
  spo2: number | null; // blood oxygen %
}

export interface RecoveryInsights {
  hasData: boolean;
  snapshot: RecoverySnapshot;
  readiness: ReadinessResult | null;
  pattern: RecoveryPattern;
  focus: string[];
  history: { day: string; band: string | null }[];
}

const EMPTY_SNAPSHOT: RecoverySnapshot = {
  signalDays: { hrv: null, restingHr: null, sleep: null, recovery: null },
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
  respiratoryRate: null,
  skinTempCelsius: null,
  spo2: null,
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
      .where(and(eq(hrvRecords.athleteId, athleteId), gte(hrvRecords.day, cutoff), lte(hrvRecords.day, today))),
    db
      .select({ day: restingHrRecords.day, hr: restingHrRecords.restingHr })
      .from(restingHrRecords)
      .where(and(eq(restingHrRecords.athleteId, athleteId), gte(restingHrRecords.day, cutoff), lte(restingHrRecords.day, today))),
    db
      .select({
        day: sleepRecords.day,
        total: sleepRecords.totalSleepSeconds,
        deep: sleepRecords.deepSeconds,
        rem: sleepRecords.remSeconds,
        score: sleepRecords.sleepScore,
        metrics: sleepRecords.metrics,
      })
      .from(sleepRecords)
      .where(and(eq(sleepRecords.athleteId, athleteId), gte(sleepRecords.day, cutoff), lte(sleepRecords.day, today))),
    db
      .select({ day: dailySummaries.day, metrics: dailySummaries.metrics })
      .from(dailySummaries)
      .where(and(eq(dailySummaries.athleteId, athleteId), gte(dailySummaries.day, cutoff), lte(dailySummaries.day, today))),
    db
      .select({
        day: checkIns.day,
        soreness: checkIns.soreness,
        energy: checkIns.energy,
        yesterdayRpe: checkIns.yesterdayRpe,
        lifeStress: checkIns.lifeStress,
        sleepQuality: checkIns.sleepQuality,
      })
      .from(checkIns)
      .where(and(eq(checkIns.athleteId, athleteId), gte(checkIns.day, cutoff), lte(checkIns.day, today))),
  ]);

  const hasData = hrvRows.length > 0 || rhrRows.length > 0 || sleepRows.length > 0;


  // Readings for the engine (drop nulls).
  const hrv: DailyReading[] = hrvRows.filter((r) => r.ms != null).map((r) => ({ day: r.day, value: r.ms! }));
  const rhr: DailyReading[] = rhrRows.map((r) => ({ day: r.day, value: r.hr }));
  const sleepHrs: DailyReading[] = sleepRows
    .filter((r) => r.total != null)
    .map((r) => ({ day: r.day, value: r.total! / 3600 }));

  const hrvBase = currentSignal(hrv, today);
  const rhrBase = currentSignal(rhr, today);
  const sleepBase = currentSignal(sleepHrs, today);

  // Latest sleep row (by day) for the last-night detail.
  const latestSleep = [...sleepRows].sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;

  // Latest Whoop recovery score from daily summaries' metrics blob.
  const summariesByDay = [...summaryRows].sort((a, b) => b.day.localeCompare(a.day));
  let recoveryScore: number | null = null;
  let recoveryDay: string | null = null;
  for (const s of summariesByDay) {
    const m = s.metrics as Record<string, number | null> | null;
    const rs = m?.recovery_score;
    if (typeof rs === "number" && Number.isFinite(rs) && rs >= 0 && rs <= 100 && s.day >= addDays(today, -1)) {
      recoveryDay = s.day;
      recoveryScore = Math.round(rs);
      break;
    }
  }
  const recoveryBand =
    recoveryScore == null ? null : recoveryScore >= 67 ? 'green' : recoveryScore >= 34 ? 'yellow' : 'red';

  // Secondary markers: respiratory rate from last night's sleep; SpO2 + skin
  // temp from the latest daily summary. Early-illness / strain signals.
  const sleepMetrics = (latestSleep?.metrics as Record<string, number | null> | null) ?? null;
  const latestSummaryMetrics = (summariesByDay[0]?.metrics as Record<string, number | null> | null) ?? null;
  const round1 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 10) / 10);

  // Most recent day across signals = the snapshot "as of".
  const allDays = [...hrv, ...rhr, ...sleepHrs].map((r) => r.day);
  const asOf = allDays.length ? allDays.sort().at(-1)! : null;

  const snapshot: RecoverySnapshot = {
    asOf,
    signalDays: { hrv: hrvBase.day, restingHr: rhrBase.day, sleep: latestSleep?.day ?? null, recovery: recoveryDay },
    recoveryScore,
    recoveryBand,
    hrvMs: hrvBase.value != null ? Math.round(hrvBase.value) : null,
    hrvZ: hrvBase.z,
    hrvTrend: trendFromZ(hrvBase.z),
    restingHr: rhrBase.value != null ? Math.round(rhrBase.value) : null,
    restingHrZ: rhrBase.z,
    restingHrTrend: trendFromZ(rhrBase.z, true), // higher RHR = worse
    sleepHours: latestSleep?.total != null ? Math.round((latestSleep.total / 3600) * 10) / 10 : null,
    sleepPerfPct: sleepMetrics?.sleep_performance_pct ?? null,
    deepMin: latestSleep?.deep != null ? Math.round(latestSleep.deep / 60) : null,
    remMin: latestSleep?.rem != null ? Math.round(latestSleep.rem / 60) : null,
    sleepTrend: trendFromZ(sleepBase.z),
    hrvSeries: lastN(hrv, 14),
    restingHrSeries: lastN(rhr, 14),
    n: hrvBase.n,
    respiratoryRate: round1(sleepMetrics?.respiratory_rate),
    skinTempCelsius: round1(latestSummaryMetrics?.skin_temp_celsius),
    spo2: round1(latestSummaryMetrics?.spo2_percentage),
  };

  // --- Live readiness via the pure engine ---
  const todayCheck = recentChecks.find((c) => c.day === today) ?? null;
  const readiness = assessReadiness({
    day: today,
    hrvZ: hrvBase.z,
    restingHrZ: rhrBase.z,
    sleepZ: sleepBase.z,
    soreness: todayCheck?.soreness ?? null,
    energy: todayCheck?.energy ?? null,
    yesterdayRpe: todayCheck?.yesterdayRpe ?? null,
    lifeStress: todayCheck?.lifeStress ?? null,
    sleepQuality: todayCheck?.sleepQuality ?? null,
  });

  const live = readiness.drivers.length ? readiness : null;
  // Reconstruct the recent window from source data. Trends must not depend on
  // whether the athlete happened to open the app and persist a score that day.
  const history = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    const c = recentChecks.find((r) => r.day === day);
    const result = assessReadiness({ day,
      hrvZ: currentSignal(hrv, day).z, restingHrZ: currentSignal(rhr, day).z,
      sleepZ: currentSignal(sleepHrs, day).z,
      soreness: c?.soreness ?? null, energy: c?.energy ?? null,
      yesterdayRpe: c?.yesterdayRpe ?? null, lifeStress: c?.lifeStress, sleepQuality: c?.sleepQuality,
    });
    // A historical date requires its own observation; yesterday's wearable
    // reading must not manufacture a second day of evidence.
    const observed = !!c || [...hrv, ...rhr, ...sleepHrs].some((r) => r.day === day);
    return { day, band: observed && result.drivers.length ? result.band : null };
  });
  const pattern = recoveryPattern(history, today);
  const focus = recoveryFocus({ ...todayCheck, sleepZ: sleepBase.z, strained: pattern.kind === "strained" });
  return { hasData, snapshot: hasData ? snapshot : EMPTY_SNAPSHOT, readiness: live,
    history, pattern, focus };
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
