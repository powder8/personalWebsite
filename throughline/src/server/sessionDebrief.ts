/**
 * Coach's debrief for the athlete's latest NON-run session — the DB half of
 * sessionDebriefLogic. Looks up what was planned that day in the same sport
 * (so a ride is judged against the planned ride, never the planned run) and the
 * athlete's threshold HR if they have one, then builds the debrief.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, plans, plannedSessions } from '@/db/schema';
import type { AthletePowerConfig } from '@/engine/plan';
import type { Units } from '@/lib/units';
import type { LatestSession } from '@/server/latestSessionLogic';
import type { RunDebriefResult } from '@/server/runDebrief';
import { buildSessionDebrief } from '@/server/sessionDebriefLogic';

export async function getSessionDebrief(db: DB, athleteId: string, session: LatestSession, units: Units): Promise<RunDebriefResult> {
  const [planned, [athlete]] = await Promise.all([
    db
      .select({
        sessionType: plannedSessions.sessionType,
        durationSeconds: plannedSessions.targetDurationSeconds,
        distanceMeters: plannedSessions.targetDistanceMeters,
      })
      .from(plannedSessions)
      .innerJoin(plans, eq(plannedSessions.planId, plans.id))
      .where(
        and(
          eq(plannedSessions.athleteId, athleteId),
          eq(plannedSessions.day, session.day),
          // Same SPORT as the session — the planned ride, not the planned run.
          eq(plannedSessions.discipline, session.sport),
          eq(plans.status, 'published'),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null),
    db.select({ powerConfig: athletes.powerConfig }).from(athletes).where(eq(athletes.id, athleteId)).limit(1),
  ]);

  const lthrBpm = session.sport === 'bike' ? ((athlete?.powerConfig as AthletePowerConfig | null)?.lthrBpm ?? null) : null;

  return buildSessionDebrief({
    sport: session.sport,
    distanceMeters: session.distanceMeters,
    durationSeconds: session.durationSeconds,
    avgHr: session.avgHr,
    maxHr: session.maxHr ?? null,
    elevationGainMeters: session.elevationGainMeters,
    planned: planned
      ? { sessionType: planned.sessionType, durationSeconds: planned.durationSeconds, distanceMeters: planned.distanceMeters }
      : null,
    lthrBpm,
    units,
  });
}
