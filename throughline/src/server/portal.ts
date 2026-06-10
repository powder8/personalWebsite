import 'server-only';
/**
 * Read model for the ATHLETE-facing portal (`/me/[id]`). This is intentionally
 * separate from the coach console (`getAthleteDetail`): the athlete sees a
 * focused "what do I do today / this week" surface, not the management tooling.
 *
 * Like the console, "today" is fixed to the demo reference date so the shared
 * dev instance is stable.
 */
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { applyDirectives } from '@/engine/plan';
import { getUpcomingWeeks } from '@/server/season';
import { listActiveDirectives, type DirectiveRow } from '@/server/directives';
import {
  athletes,
  readinessAssessments,
  plans,
  plannedSessions,
  checkIns,
  activities,
} from '@/db/schema';
import { todayISO, type Band } from '@/server/console';
import { getStravaAccount } from '@/server/strava';
import { stravaConfigured } from '@/providers/strava/env';

export interface PortalSession {
  id: string;
  day: string;
  sessionType: string;
  distanceMeters: number | null;
  paceFastSecPerKm: number | null;
  paceSlowSecPerKm: number | null;
  description: string | null;
  pinned: boolean;
  adjustments: string[];
}

export interface PortalWeek {
  weekStart: string;
  weekEnd: string;
  phase: string | null;
  sessions: PortalSession[];
}

export interface AthletePortal {
  athlete: typeof athletes.$inferSelect;
  today: string;
  readiness: { score: number | null; band: Band | null; sentence: string | null };
  todaySession: PortalSession | null;
  thisWeek: PortalWeek | null;
  comingWeeks: PortalWeek[];
  goalRace: { name: string | null; date: string | null; daysAway: number | null };
  unavailable: DirectiveRow[];
  checkedInToday: boolean;
  recentCheckIns: { day: string; soreness: number | null; energy: number | null; yesterdayRpe: number | null }[];
  strava: { configured: boolean; connected: boolean; lastActivityDay: string | null };
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export async function getAthletePortal(id: string): Promise<AthletePortal | null> {
  const TODAY = todayISO();
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) return null;

  const [readiness] = await db
    .select()
    .from(readinessAssessments)
    .where(and(eq(readinessAssessments.athleteId, id), eq(readinessAssessments.day, TODAY)))
    .limit(1);

  const directiveRows = await listActiveDirectives(db, id);
  const overlay = (s: typeof plannedSessions.$inferSelect): PortalSession => {
    const adj = applyDirectives(
      {
        day: s.day,
        sessionType: s.sessionType,
        distanceMeters: s.targetDistanceMeters,
        paceFastSecPerKm: s.targetPaceFastSecPerKm,
        paceSlowSecPerKm: s.targetPaceSlowSecPerKm,
      },
      directiveRows,
    );
    return {
      id: s.id,
      day: s.day,
      sessionType: adj.sessionType,
      distanceMeters: adj.distanceMeters,
      paceFastSecPerKm: adj.paceFastSecPerKm,
      paceSlowSecPerKm: adj.paceSlowSecPerKm,
      description: s.description,
      pinned: s.pinned,
      adjustments: adj.adjustments,
    };
  };

  // Current published week.
  const [plan] = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.athleteId, id),
        eq(plans.status, 'published'),
        lte(plans.weekStart, TODAY),
        gte(plans.weekEnd, TODAY),
      ),
    )
    .limit(1);

  let thisWeek: PortalWeek | null = null;
  let todaySession: PortalSession | null = null;
  if (plan) {
    const rows = await db
      .select()
      .from(plannedSessions)
      .where(eq(plannedSessions.planId, plan.id))
      .orderBy(plannedSessions.day);
    const sessions = rows.map(overlay);
    thisWeek = { weekStart: plan.weekStart, weekEnd: plan.weekEnd, phase: plan.phase, sessions };
    todaySession = sessions.find((s) => s.day === TODAY) ?? null;
  }

  // Look ahead (exclude the current week — that's `thisWeek`).
  const upcoming = await getUpcomingWeeks(db, id, TODAY, 4);
  const comingWeeks: PortalWeek[] = upcoming
    .filter((w) => !(w.weekStart <= TODAY && TODAY <= w.weekEnd))
    .map((w) => ({
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      phase: w.phase,
      sessions: w.sessions.map(overlay),
    }));

  const recent = await db
    .select()
    .from(checkIns)
    .where(eq(checkIns.athleteId, id))
    .orderBy(desc(checkIns.day))
    .limit(7);

  const daysAway = athlete.goalRaceDate ? daysBetween(TODAY, athlete.goalRaceDate) : null;

  const stravaAcct = await getStravaAccount(db, id);
  let lastActivityDay: string | null = null;
  if (stravaAcct) {
    const [latest] = await db
      .select({ startTime: activities.startTime })
      .from(activities)
      .where(eq(activities.athleteId, id))
      .orderBy(desc(activities.startTime))
      .limit(1);
    lastActivityDay = latest?.startTime ? latest.startTime.toISOString().slice(0, 10) : null;
  }

  return {
    athlete,
    today: TODAY,
    readiness: {
      score: readiness?.score ?? null,
      band: (readiness?.band as Band | undefined) ?? null,
      sentence: readiness?.sentence ?? null,
    },
    todaySession,
    thisWeek,
    comingWeeks,
    goalRace: { name: athlete.goalRace, date: athlete.goalRaceDate, daysAway },
    unavailable: directiveRows.filter((d) => d.type === 'unavailable'),
    checkedInToday: recent.some((c) => c.day === TODAY),
    recentCheckIns: recent.map((c) => ({
      day: c.day,
      soreness: c.soreness,
      energy: c.energy,
      yesterdayRpe: c.yesterdayRpe,
    })),
    strava: {
      configured: stravaConfigured(),
      connected: !!stravaAcct && stravaAcct.status === 'active',
      lastActivityDay,
    },
  };
}
