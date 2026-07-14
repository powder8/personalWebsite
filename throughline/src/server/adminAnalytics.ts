/**
 * Analytics read model. Two audiences, one query:
 *  - ADMIN (site owner): the whole website — growth/signups, all engagement,
 *    site-wide feedback.
 *  - COACH: the SAME training/engagement metrics but scoped to only the
 *    athletes assigned to them; the site-wide business numbers (total signed-up
 *    accounts, product feedback) are not theirs to see and the page hides them.
 *
 * Scope filters every athlete-keyed dataset to the given id set; `site` skips
 * the filter. Feedback and the users count are inherently site-wide (not per
 * athlete), so they are always computed but only rendered for admins.
 *
 * The roster is small, so we take minimal-column selects and aggregate in TS
 * (adminAnalyticsLogic) rather than dialect-sensitive SQL — the same code runs
 * on PGlite locally and Neon in prod.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  athletes,
  users,
  connectedAccounts,
  activities,
  checkIns,
  plans,
  plannedSessions,
  races,
  feedback,
  escalations,
  readinessAssessments,
} from '@/db/schema';
import { bucketByWeek, distribution, type WeekBucket } from '@/server/adminAnalyticsLogic';

/** Which athletes this analytics view covers. */
export type AnalyticsScope = { kind: 'site' } | { kind: 'coach'; athleteIds: Set<string> };

export interface AdminAnalytics {
  scope: 'site' | 'coach';
  growth: {
    activeAthletes: number;
    signedUpUsers: number; // auth accounts (site-wide; admin only)
    onboarded: number;
    autonomous: number;
    assisted: number;
    athleteSignupsByWeek: WeekBucket[]; // trailing 12 weeks (scoped)
  };
  engagement: {
    activeAthletes7d: number; // logged any activity in the last 7 days
    runs28d: number;
    miles28d: number;
    checkIns7d: number;
    stravaConnected: number;
    whoopConnected: number;
  };
  training: {
    athletesWithLivePlan: number;
    phaseMix: { key: string; count: number }[]; // current week's phase per athlete
    sessionMix7d: { key: string; count: number }[]; // planned sessions, next 7 days
    plannedMiles7d: number;
  };
  goals: {
    withGoalRace: number;
    withTargetTime: number;
    distanceMix: { key: string; count: number }[];
  };
  readinessToday: { key: string; count: number }[]; // band distribution
  feedback: {
    // Site-wide product feedback (admin only).
    open: number;
    addressed: number;
    recent: { author: string; category: string | null; body: string; status: string; createdAt: string }[];
  };
  escalations: { open: number; byKind: { key: string; count: number }[] };
}

function daysAgo(today: string, n: number): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}
function addDaysISO(today: string, n: number): string {
  return daysAgo(today, -n);
}

export async function getAdminAnalytics(
  db: DB,
  today: string,
  scope: AnalyticsScope = { kind: 'site' },
): Promise<AdminAnalytics> {
  const cutoff28 = daysAgo(today, 27);
  const cutoff7 = daysAgo(today, 6);
  const signupWindow = daysAgo(today, 12 * 7);

  const [
    athleteRowsAll,
    userRows,
    connRowsAll,
    activityRowsAll,
    checkInRowsAll,
    planRowsAll,
    sessionRowsAll,
    goalRowsAll,
    feedbackRows,
    escalationRowsAll,
    readinessRowsAll,
  ] = await Promise.all([
    db
      .select({
        id: athletes.id,
        createdAt: athletes.createdAt,
        active: athletes.active,
        coachingMode: athletes.coachingMode,
        onboardedAt: athletes.onboardedAt,
      })
      .from(athletes),
    db.select({ id: users.id }).from(users),
    db
      .select({ provider: connectedAccounts.provider, status: connectedAccounts.status, athleteId: connectedAccounts.athleteId })
      .from(connectedAccounts),
    db
      .select({ athleteId: activities.athleteId, startTime: activities.startTime, distanceMeters: activities.distanceMeters, sport: activities.sport })
      .from(activities)
      .where(gte(activities.startTime, new Date(Date.parse(cutoff28)))),
    db.select({ athleteId: checkIns.athleteId, day: checkIns.day }).from(checkIns).where(gte(checkIns.day, cutoff7)),
    db
      .select({ athleteId: plans.athleteId, weekStart: plans.weekStart, weekEnd: plans.weekEnd, phase: plans.phase })
      .from(plans)
      .where(gte(plans.weekEnd, today)),
    db
      .select({
        athleteId: plannedSessions.athleteId,
        sessionType: plannedSessions.sessionType,
        day: plannedSessions.day,
        meters: plannedSessions.targetDistanceMeters,
      })
      .from(plannedSessions)
      .where(gte(plannedSessions.day, today)),
    db
      .select({ athleteId: races.athleteId, distanceLabel: races.distanceLabel, targetTimeSeconds: races.targetTimeSeconds })
      .from(races)
      .where(and(eq(races.priority, 'goal'), gte(races.date, today))),
    db
      .select({
        author: feedback.author,
        category: feedback.category,
        body: feedback.body,
        status: feedback.status,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .orderBy(desc(feedback.createdAt))
      .limit(200),
    db.select({ athleteId: escalations.athleteId, kind: escalations.kind, status: escalations.status }).from(escalations),
    db
      .select({ athleteId: readinessAssessments.athleteId, band: readinessAssessments.band })
      .from(readinessAssessments)
      .where(eq(readinessAssessments.day, today)),
  ]);

  // --- Scope every athlete-keyed dataset to the viewer's athletes ---
  const inScope = (athleteId: string) => scope.kind === 'site' || scope.athleteIds.has(athleteId);
  const athleteRows = scope.kind === 'site' ? athleteRowsAll : athleteRowsAll.filter((a) => scope.athleteIds.has(a.id));
  const connRows = connRowsAll.filter((c) => c.athleteId != null && inScope(c.athleteId));
  const activityRows = activityRowsAll.filter((a) => inScope(a.athleteId));
  const checkInRows = checkInRowsAll.filter((c) => inScope(c.athleteId));
  const planRows = planRowsAll.filter((p) => inScope(p.athleteId));
  const sessionRows = sessionRowsAll.filter((s) => inScope(s.athleteId));
  const goalRows = goalRowsAll.filter((g) => inScope(g.athleteId));
  const escalationRows = escalationRowsAll.filter((e) => inScope(e.athleteId));
  const readinessRows = readinessRowsAll.filter((r) => inScope(r.athleteId));

  // --- Growth ---
  const activeAthleteRows = athleteRows.filter((a) => a.active);
  const signupDays = athleteRows
    .map((a) => a.createdAt?.toISOString().slice(0, 10))
    .filter((d): d is string => !!d && d >= signupWindow);

  // --- Engagement ---
  const cutoff7Ms = Date.parse(cutoff7);
  const activeIds7d = new Set(
    activityRows.filter((a) => a.startTime.getTime() >= cutoff7Ms).map((a) => a.athleteId),
  );
  const runs = activityRows.filter((a) => a.sport === 'run');
  const connected = (provider: string) =>
    new Set(connRows.filter((c) => c.provider === provider && c.status === 'active').map((c) => c.athleteId)).size;

  // --- Training ---
  const currentWeekPlans = planRows.filter((p) => p.weekStart <= today);
  const liveAthletes = new Set(planRows.map((p) => p.athleteId));
  const weekAhead = addDaysISO(today, 6);
  const upcoming = sessionRows.filter((s) => s.day <= weekAhead && s.sessionType !== 'rest');

  return {
    scope: scope.kind,
    growth: {
      activeAthletes: activeAthleteRows.length,
      signedUpUsers: userRows.length,
      onboarded: athleteRows.filter((a) => a.onboardedAt != null).length,
      autonomous: activeAthleteRows.filter((a) => a.coachingMode === 'autonomous').length,
      assisted: activeAthleteRows.filter((a) => a.coachingMode === 'assisted').length,
      athleteSignupsByWeek: bucketByWeek(signupDays, today, 12),
    },
    engagement: {
      activeAthletes7d: activeIds7d.size,
      runs28d: runs.length,
      miles28d: Math.round(runs.reduce((s, a) => s + (a.distanceMeters ?? 0), 0) / 1609.344),
      checkIns7d: checkInRows.length,
      stravaConnected: connected('strava'),
      whoopConnected: connected('whoop'),
    },
    training: {
      athletesWithLivePlan: liveAthletes.size,
      phaseMix: distribution(currentWeekPlans.map((p) => p.phase)),
      sessionMix7d: distribution(upcoming.map((s) => s.sessionType)),
      plannedMiles7d: Math.round(upcoming.reduce((s, x) => s + (x.meters ?? 0), 0) / 1609.344),
    },
    goals: {
      withGoalRace: goalRows.length,
      withTargetTime: goalRows.filter((g) => g.targetTimeSeconds != null).length,
      distanceMix: distribution(goalRows.map((g) => g.distanceLabel ?? 'Other')),
    },
    readinessToday: distribution(readinessRows.map((r) => r.band)),
    feedback: {
      open: feedbackRows.filter((f) => f.status === 'open').length,
      addressed: feedbackRows.filter((f) => f.status === 'addressed').length,
      recent: feedbackRows.slice(0, 8).map((f) => ({
        author: f.author,
        category: f.category,
        body: f.body,
        status: f.status,
        createdAt: f.createdAt.toISOString().slice(0, 10),
      })),
    },
    escalations: {
      open: escalationRows.filter((e) => e.status === 'open').length,
      byKind: distribution(escalationRows.filter((e) => e.status === 'open').map((e) => e.kind)),
    },
  };
}
