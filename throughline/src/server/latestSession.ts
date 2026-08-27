import 'server-only';
/**
 * The athlete's most recent NON-run session (bike / swim / strength) in the
 * window — the multisport counterpart to getLatestRunFeedback. The portal shows
 * whichever session (run vs. this) is more recent, so a ride or swim leads the
 * "how training is going" read instead of being demoted to cross-training.
 */
import { and, desc, eq, gte, lte, ne } from 'drizzle-orm';
import type { DB } from '@/db';
import { activities } from '@/db/schema';
import type { LatestSession, SessionSport } from '@/server/latestSessionLogic';

const TRACKED: Set<string> = new Set(['bike', 'swim', 'strength']);

export async function getLatestNonRunSession(
  db: DB,
  athleteId: string,
  today: string,
  lookbackDays = 14,
): Promise<LatestSession | null> {
  const since = new Date(`${today}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const rows = await db
    .select({
      id: activities.id,
      sport: activities.sport,
      name: activities.name,
      startTime: activities.startTime,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
      elevationGainMeters: activities.elevationGainMeters,
      avgHr: activities.avgHr,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        ne(activities.sport, 'run'),
        gte(activities.startTime, since),
        lte(activities.startTime, new Date(`${today}T23:59:59.999Z`)),
      ),
    )
    .orderBy(desc(activities.startTime))
    .limit(1);

  const row = rows[0];
  if (!row || !TRACKED.has(row.sport)) return null;

  const day = row.startTime.toISOString().slice(0, 10);
  const daysAgo = Math.round(
    (Date.UTC(...(today.split('-').map(Number) as [number, number, number])) -
      Date.UTC(...(day.split('-').map(Number) as [number, number, number]))) /
      86400000,
  );
  return {
    activityId: row.id,
    sport: row.sport as SessionSport,
    name: row.name,
    day,
    daysAgo,
    distanceMeters: row.distanceMeters,
    durationSeconds: row.durationSeconds,
    elevationGainMeters: row.elevationGainMeters,
    avgHr: row.avgHr,
  };
}
