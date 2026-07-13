/**
 * Admin analytics read model — the coach's "how is the product doing?" view.
 * Growth (signups), engagement (activity, check-ins, connections), training
 * (live plans, phases, upcoming session mix), goals, today's readiness, and
 * the feedback/escalation queues, in one fetch.
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

export interface AdminAnalytics {
  growth: {
    activeAthletes: number;
    signedUpUsers: number; // auth accounts (athletes + coaches)
    onboarded: number;
    autonomous: number;
    assisted: number;
    athleteSignupsByWeek: WeekBucket[]; // trailing 12 weeks
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

export async function getAdminAnalytics(db: DB, today: string): Promise<AdminAnalytics> {
  const cutoff28 = daysAgo(today, 27);
  const cutoff7 = daysAgo(today, 6);
  const signupWindow = daysAgo(today, 12 * 7);

  const [
    athleteRows,
    userRows,
    connRows,
    activityRows,
    checkInRows,
    planRows,
    sessionRows,
    goalRows,
    feedbackRows,
    escalationRows,
    readinessRows,
  ] = await Promise.all([
    db
      .select({
        id: athletes.id,
        createdAt: athletes.createdAt,
        active: athletes.active,
        coachingMode: athletes.coachingMode,
        onboardedAt: athletes.onboardedAt,
        goalRace: athletes.goalRace,
        goalRaceDate: athletes.goalRaceDate,
      })
      .from(athletes),
    db.select({ id: users.id, createdAt: users.createdAt }).from(users),
    db
      .select({ provider: connectedAccounts.provider, status: connectedAccounts.status, athleteId: connectedAccounts.athleteId })
      .from(connectedAccounts),
    db
      .select({ athleteId: activities.athleteId, startTime: activities.startTime, distanceMeters: activities.distanceMeters, sport: activities.sport })
      .from(activities)
      .where(gte(activities.startTime, new Date(Date.parse(cutoff28)))),
    db.select({ day: checkIns.day }).from(checkIns).where(gte(checkIns.day, cutoff7)),
    db
      .select({ athleteId: plans.athleteId, weekStart: plans.weekStart, weekEnd: plans.weekEnd, phase: plans.phase, status: plans.status })
      .from(plans)
      .where(gte(plans.weekEnd, today)),
    db
      .select({ sessionType: plannedSessions.sessionType, day: plannedSessions.day, meters: plannedSessions.targetDistanceMeters })
      .from(plannedSessions)
      .where(gte(plannedSessions.day, today)),
    db
      .select({ distanceLabel: races.distanceLabel, targetTimeSeconds: races.targetTimeSeconds, date: races.date })
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
    db.select({ kind: escalations.kind, status: escalations.status }).from(escalations),
    db
      .select({ band: readinessAssessments.band })
      .from(readinessAssessments)
      .where(eq(readinessAssessments.day, today)),
  ]);

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
