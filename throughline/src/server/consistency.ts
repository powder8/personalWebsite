import 'server-only';
/**
 * Consistency / streak stats. Actuals come straight from the athlete's LOGGED
 * ACTIVITIES over the window — NOT from published-plan coverage. That distinction
 * matters: when a plan is regenerated (a new goal, a sport added) its weeks only
 * span the recent stretch, so a plan-limited count silently dropped every run
 * before the current plan started. Counting from activities fixes that
 * undercount and treats every sport as training (a step toward first-class
 * multisport: runs, rides, swims, strength all count as active days).
 *
 * Weekly adherence stays plan-based (adherence only means anything against a plan).
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities } from '@/db/schema';
import { getComplianceWeeks, type DayStatus } from '@/server/compliance';
import { computeConsistency, assembleConsistencyDays, type ConsistencyStats } from '@/server/consistencyLogic';

export type { ConsistencyStats } from '@/server/consistencyLogic';

const MI = 1609.344;
const WEEKS_BACK = 8;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function getConsistency(athleteId: string, today: string): Promise<ConsistencyStats | null> {
  const db = await getDb();
  const windowStart = addDays(today, -7 * WEEKS_BACK + 1);

  // Weekly adherence is inherently plan-based — keep it from the compliance report.
  const report = await getComplianceWeeks(athleteId, today, WEEKS_BACK);
  const weeklyAdherence = report.weeks
    .filter((w) => w.weekEnd < today && w.actualMiles > 0)
    .map((w) => w.adherencePct);
  // Plan-day statuses (used for streak semantics where a plan actually exists).
  const statusByDay = new Map<string, DayStatus>();
  for (const w of report.weeks) for (const d of w.days) if (d.day <= today) statusByDay.set(d.day, d.status);

  // Actuals for the whole window, straight from activities (plan-independent).
  const actRows = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      distanceMeters: activities.distanceMeters,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        gte(activities.startTime, new Date(`${windowStart}T00:00:00Z`)),
        lte(activities.startTime, new Date(`${addDays(today, 1)}T00:00:00Z`)),
      ),
    );

  const runMilesByDay = new Map<string, number>();
  const crossDays = new Set<string>();
  for (const a of actRows) {
    const day = a.startTime.toISOString().slice(0, 10);
    if (day > today || day < windowStart) continue;
    if (a.sport === 'run') {
      runMilesByDay.set(day, (runMilesByDay.get(day) ?? 0) + (a.distanceMeters ?? 0) / MI);
    } else {
      crossDays.add(day); // bike / swim / strength / cross-train — all count as active
    }
  }

  if (runMilesByDay.size === 0 && crossDays.size === 0) return null;

  const days = assembleConsistencyDays({ windowStart, today, statusByDay, runMilesByDay, crossDays });
  return computeConsistency({ today, days, weeklyAdherence });
}
