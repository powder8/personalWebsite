import 'server-only';
/**
 * Opt-in menstrual cycle tracking. Athletes enter their last period start, avg
 * cycle length, and period length; we project upcoming cycles and the current
 * phase so they (and their coach) can plan around it — late luteal often brings
 * fatigue, so key racing is best avoided then.
 *
 * This is sensitive health data: it only exists when the athlete opts in, and is
 * surfaced on their own portal (the coach sees a phase summary for planning).
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { cycleTracking } from '@/db/schema';
import { computeCycle, type CycleSettings, type CyclePhase, type CycleStatus } from '@/server/cycleMath';

export { computeCycle };
export type { CycleSettings, CyclePhase, CycleStatus };

export async function getCycle(db: DB, athleteId: string): Promise<CycleSettings> {
  const [row] = await db.select().from(cycleTracking).where(eq(cycleTracking.athleteId, athleteId)).limit(1);
  return {
    enabled: row?.enabled ?? false,
    lastStartDate: row?.lastStartDate ?? null,
    avgCycleDays: row?.avgCycleDays ?? 28,
    avgPeriodDays: row?.avgPeriodDays ?? 5,
  };
}

export async function setCycle(db: DB, athleteId: string, s: CycleSettings): Promise<void> {
  const avgCycleDays = Math.max(15, Math.min(60, Math.round(s.avgCycleDays || 28)));
  const avgPeriodDays = Math.max(1, Math.min(14, Math.round(s.avgPeriodDays || 5)));
  const values = {
    athleteId,
    enabled: s.enabled,
    lastStartDate: s.lastStartDate || null,
    avgCycleDays,
    avgPeriodDays,
    updatedAt: new Date(),
  };
  await db
    .insert(cycleTracking)
    .values(values)
    .onConflictDoUpdate({
      target: cycleTracking.athleteId,
      set: {
        enabled: values.enabled,
        lastStartDate: values.lastStartDate,
        avgCycleDays: values.avgCycleDays,
        avgPeriodDays: values.avgPeriodDays,
        updatedAt: values.updatedAt,
      },
    });
}
