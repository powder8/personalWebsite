/**
 * General health tracker — the DB half of healthTrendLogic. Pulls ~12 weeks of
 * each health signal (resting HR, HRV, sleep, weight, daily steps) from the
 * per-day record tables and builds one consistent trend per metric.
 *
 * Health, not training: these describe the athlete, they never feed the
 * training-load model.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import { dailySummaries, hrvRecords, restingHrRecords, sleepRecords } from '@/db/schema';
import { buildHealthTrend, type DailySample, type HealthMetric, type HealthTrend } from '@/server/healthTrendLogic';

export interface HealthTrends {
  trends: HealthTrend[]; // only metrics with at least one reading, in display order
  windowWeeks: number;
}

const ORDER: HealthMetric[] = ['resting_hr', 'hrv', 'sleep', 'weight', 'steps'];

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function getHealthTrends(db: DB, athleteId: string, today: string, weeks = 12): Promise<HealthTrends> {
  const since = addDays(today, -(weeks * 7) + 1);

  const [rhr, hrv, sleep, daily] = await Promise.all([
    db
      .select({ day: restingHrRecords.day, v: restingHrRecords.restingHr })
      .from(restingHrRecords)
      .where(and(eq(restingHrRecords.athleteId, athleteId), gte(restingHrRecords.day, since))),
    db
      .select({ day: hrvRecords.day, v: hrvRecords.overnightAvgMs })
      .from(hrvRecords)
      .where(and(eq(hrvRecords.athleteId, athleteId), gte(hrvRecords.day, since))),
    db
      .select({ day: sleepRecords.day, v: sleepRecords.totalSleepSeconds })
      .from(sleepRecords)
      .where(and(eq(sleepRecords.athleteId, athleteId), gte(sleepRecords.day, since))),
    db
      .select({ day: dailySummaries.day, weight: dailySummaries.weightKg, steps: dailySummaries.steps })
      .from(dailySummaries)
      .where(and(eq(dailySummaries.athleteId, athleteId), gte(dailySummaries.day, since))),
  ]);

  const samples = (rows: { day: string; v: number | null }[]): DailySample[] =>
    rows.filter((r) => r.v != null).map((r) => ({ day: r.day, value: r.v as number }));

  const byMetric: Record<HealthMetric, DailySample[]> = {
    resting_hr: samples(rhr),
    hrv: samples(hrv),
    // Sleep in hours — the unit people think in.
    sleep: samples(sleep).map((s) => ({ ...s, value: s.value / 3600 })),
    weight: samples(daily.map((d) => ({ day: d.day, v: d.weight }))),
    steps: samples(daily.map((d) => ({ day: d.day, v: d.steps }))),
  };

  const trends = ORDER.map((m) => buildHealthTrend(m, byMetric[m], { today, weeks })).filter((t) => t.days > 0);
  return { trends, windowWeeks: weeks };
}
