import 'server-only';
/**
 * Read model for the coach console. Server-only data access; pages call these.
 * "Today" is fixed to the seed's reference date so the dev demo is stable.
 */
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { getDb, type DB } from '@/db';
import {
  suggestRaceWindows,
  annotateWindows,
  paceRangeLabel,
  equivalentPerformances,
  type RaceWindow,
  type EquivalentPerformance,
  type AthletePaceConfig,
} from '@/engine/plan';
import { getAthleteZones, getAthleteVdot } from '@/db/paceConfig';
import { listEscalationsForAthlete, type EscalationRow } from '@/server/escalations';
import { getUpcomingWeeks, type UpcomingWeek } from '@/server/season';
import { listActiveDirectives, type DirectiveRow } from '@/server/directives';
import { applyDirectives } from '@/engine/plan';
import {
  athletes,
  readinessAssessments,
  injuryRecords,
  plans,
  plannedSessions,
  checkIns,
  athleteNotes,
  hrvRecords,
  restingHrRecords,
  sleepRecords,
  races,
  escalations,
  activities,
} from '@/db/schema';

export const TODAY = '2026-06-06';

export type Band = 'easy' | 'normal' | 'go';

export interface RosterEntry {
  id: string;
  name: string;
  race: string | null;
  raceDate: string | null;
  coachingMode: 'assisted' | 'autonomous';
  readiness: { score: number | null; band: Band | null; sentence: string | null };
  todaySession: { sessionType: string; description: string | null } | null;
  flags: string[];
  attention: number; // higher = needs attention sooner
}

function attentionScore(band: Band | null, injuries: number, missed: boolean): number {
  let n = 0;
  if (band === 'easy') n += 3;
  else if (band === 'normal') n += 1;
  if (injuries > 0) n += 2;
  if (missed) n += 1;
  return n;
}

export async function getRoster(): Promise<RosterEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(athletes).where(eq(athletes.active, true));

  const entries = await Promise.all(
    rows.map(async (a) => {
      const [readiness] = await db
        .select()
        .from(readinessAssessments)
        .where(and(eq(readinessAssessments.athleteId, a.id), eq(readinessAssessments.day, TODAY)))
        .limit(1);

      const injuries = await db
        .select()
        .from(injuryRecords)
        .where(and(eq(injuryRecords.athleteId, a.id), eq(injuryRecords.status, 'returning')));
      const acute = await db
        .select()
        .from(injuryRecords)
        .where(and(eq(injuryRecords.athleteId, a.id), eq(injuryRecords.status, 'acute')));
      const activeInjuries = injuries.length + acute.length;

      const todaySession = await getTodaySession(a.id);

      const openEsc = await db
        .select({ id: escalations.id })
        .from(escalations)
        .where(and(eq(escalations.athleteId, a.id), eq(escalations.status, 'open')));
      const needsReview = openEsc.length > 0;

      const band = (readiness?.band as Band | undefined) ?? null;
      const flags: string[] = [];
      if (band === 'easy') flags.push('low readiness');
      if (activeInjuries > 0) flags.push('active injury');
      if (needsReview) flags.push('needs review');

      return {
        id: a.id,
        name: a.fullName,
        race: a.goalRace,
        raceDate: a.goalRaceDate,
        coachingMode: a.coachingMode,
        readiness: {
          score: readiness?.score ?? null,
          band,
          sentence: readiness?.sentence ?? null,
        },
        todaySession,
        flags,
        attention: attentionScore(band, activeInjuries, false) + (needsReview ? 2 : 0),
      } satisfies RosterEntry;
    }),
  );

  return entries.sort((a, b) => b.attention - a.attention || a.name.localeCompare(b.name));
}

async function getTodaySession(athleteId: string) {
  const db = await getDb();
  const [plan] = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.athleteId, athleteId),
        eq(plans.status, 'published'),
        lte(plans.weekStart, TODAY),
        gte(plans.weekEnd, TODAY),
      ),
    )
    .limit(1);
  if (!plan) return null;
  const [session] = await db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.planId, plan.id), eq(plannedSessions.day, TODAY)))
    .limit(1);
  return session ? { sessionType: session.sessionType, description: session.description } : null;
}

export type DisplaySession = typeof plannedSessions.$inferSelect & { adjustments: string[] };

export interface AthleteDetail {
  athlete: typeof athletes.$inferSelect;
  readinessToday: typeof readinessAssessments.$inferSelect | null;
  readinessHistory: typeof readinessAssessments.$inferSelect[];
  currentWeek: {
    plan: typeof plans.$inferSelect;
    sessions: DisplaySession[];
  } | null;
  checkIns: typeof checkIns.$inferSelect[];
  notes: typeof athleteNotes.$inferSelect[];
  injuries: typeof injuryRecords.$inferSelect[];
  races: typeof races.$inferSelect[];
  raceWindows: (RaceWindow & { filledBy: typeof races.$inferSelect | null })[];
  escalations: EscalationRow[];
  upcomingWeeks: (Omit<UpcomingWeek, 'sessions'> & { sessions: DisplaySession[] })[];
  directives: DirectiveRow[];
  paceZones: { key: string; label: string }[];
  vdot: number | null;
  equivalents: EquivalentPerformance[];
  strengthBias: number;
  activitySummary: { count: number; totalMiles: number; firstDay: string | null; lastDay: string | null };
  recentActivities: { day: string; distanceMiles: number; paceSecPerKm: number | null; sport: string }[];
  signals: {
    hrv: { day: string; value: number | null }[];
    restingHr: { day: string; value: number | null }[];
    sleepHours: { day: string; value: number | null }[];
  };
}

export async function getAthleteDetail(id: string): Promise<AthleteDetail | null> {
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) return null;

  const history = await db
    .select()
    .from(readinessAssessments)
    .where(eq(readinessAssessments.athleteId, id))
    .orderBy(desc(readinessAssessments.day))
    .limit(14);

  const readinessToday = history.find((h) => h.day === TODAY) ?? null;

  // Active windowed adjustments (directives) overlaid on displayed sessions.
  const directiveRows = await listActiveDirectives(db, id);
  const overlay = (s: typeof plannedSessions.$inferSelect): DisplaySession => {
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
      ...s,
      sessionType: adj.sessionType as typeof s.sessionType,
      targetDistanceMeters: adj.distanceMeters,
      targetPaceFastSecPerKm: adj.paceFastSecPerKm,
      targetPaceSlowSecPerKm: adj.paceSlowSecPerKm,
      adjustments: adj.adjustments,
    };
  };

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

  let currentWeek: AthleteDetail['currentWeek'] = null;
  if (plan) {
    const sessions = await db
      .select()
      .from(plannedSessions)
      .where(eq(plannedSessions.planId, plan.id))
      .orderBy(plannedSessions.day);
    currentWeek = { plan, sessions: sessions.map(overlay) };
  }

  const recentCheckIns = await db
    .select()
    .from(checkIns)
    .where(eq(checkIns.athleteId, id))
    .orderBy(desc(checkIns.day))
    .limit(7);

  const notes = await db.select().from(athleteNotes).where(eq(athleteNotes.athleteId, id));
  const injuries = await db
    .select()
    .from(injuryRecords)
    .where(eq(injuryRecords.athleteId, id))
    .orderBy(desc(injuryRecords.onsetDate));
  const raceList = await db.select().from(races).where(eq(races.athleteId, id)).orderBy(races.date);

  // Advise tune-up windows on the path to the goal race (from today), with
  // personalized target paces from the athlete's resolved zones.
  const goal = raceList.find((r) => r.priority === 'goal');
  const zones = (await getAthleteZones(db, id)) ?? undefined;
  const raceWindows = goal
    ? annotateWindows(
        suggestRaceWindows(
          { date: goal.date, distanceMeters: goal.distanceMeters, distanceLabel: goal.distanceLabel },
          TODAY,
          zones,
        ),
        raceList.filter((r) => r.id !== goal.id),
      )
    : [];

  const since = isoDaysAgo(28);
  const hrvRows = await db
    .select({ day: hrvRecords.day, value: hrvRecords.overnightAvgMs })
    .from(hrvRecords)
    .where(and(eq(hrvRecords.athleteId, id), gte(hrvRecords.day, since)))
    .orderBy(hrvRecords.day);
  const rhrRows = await db
    .select({ day: restingHrRecords.day, value: restingHrRecords.restingHr })
    .from(restingHrRecords)
    .where(and(eq(restingHrRecords.athleteId, id), gte(restingHrRecords.day, since)))
    .orderBy(restingHrRecords.day);
  const sleepRows = await db
    .select({ day: sleepRecords.day, value: sleepRecords.totalSleepSeconds })
    .from(sleepRecords)
    .where(and(eq(sleepRecords.athleteId, id), gte(sleepRecords.day, since)))
    .orderBy(sleepRecords.day);
  const sleepHours = sleepRows.map((d) => ({ day: d.day, value: d.value == null ? null : d.value / 3600 }));

  return {
    athlete,
    readinessToday,
    readinessHistory: history.slice().reverse(),
    currentWeek,
    checkIns: recentCheckIns,
    notes,
    injuries,
    races: raceList,
    raceWindows,
    escalations: await listEscalationsForAthlete(db, id),
    upcomingWeeks: (await getUpcomingWeeks(db, id, TODAY, 4)).map((w) => ({
      ...w,
      sessions: w.sessions.map(overlay),
    })),
    directives: directiveRows,
    paceZones: zones
      ? (['recovery', 'easy', 'maintenance', 'marathon', 'threshold', 'interval', 'rep'] as const).map(
          (k) => ({ key: k, label: paceRangeLabel(zones.zones[k]) }),
        )
      : [],
    ...(await (async () => {
      const v = await getAthleteVdot(db, id);
      return {
        vdot: v != null ? Math.round(v * 10) / 10 : null,
        equivalents: v != null ? equivalentPerformances(v) : [],
      };
    })()),
    strengthBias: ((athlete.paceConfig as AthletePaceConfig | null) ?? {}).strengthBias ?? 0,
    ...(await activitySummary(db, id)),
    signals: { hrv: hrvRows, restingHr: rhrRows, sleepHours },
  };
}

async function activitySummary(
  db: DB,
  athleteId: string,
): Promise<Pick<AthleteDetail, 'activitySummary' | 'recentActivities'>> {
  const rows = await db
    .select({
      startTime: activities.startTime,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      sport: activities.sport,
    })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(desc(activities.startTime));

  const totalMiles = rows.reduce((s, r) => s + (r.distanceMeters ?? 0) / 1609.344, 0);
  const days = rows.map((r) => r.startTime.toISOString().slice(0, 10));
  return {
    activitySummary: {
      count: rows.length,
      totalMiles: Math.round(totalMiles),
      firstDay: days.length ? days[days.length - 1] : null,
      lastDay: days.length ? days[0] : null,
    },
    recentActivities: rows.slice(0, 20).map((r) => ({
      day: r.startTime.toISOString().slice(0, 10),
      distanceMiles: Math.round(((r.distanceMeters ?? 0) / 1609.344) * 10) / 10,
      paceSecPerKm: r.avgPaceSecPerKm,
      sport: r.sport,
    })),
  };
}

function isoDaysAgo(n: number): string {
  // relative to TODAY (seed reference), not the wall clock
  const [y, m, d] = TODAY.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
