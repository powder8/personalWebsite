/**
 * Autopilot: the autonomous-mode approval gate, wired to the DB.
 *
 * For an athlete, gather recent state (injuries, readiness, data freshness, and
 * how big the proposed plan change is), run the pure guardrails, and:
 *   - assisted        → leave the draft for the coach (no-op here)
 *   - autonomous+pass → auto-publish the current-week draft
 *   - autonomous+fail → hold, and record escalations for a human
 *
 * The engine that produced the plan is identical to assisted mode; only this
 * gate differs.
 */
import { and, eq, desc, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, injuryRecords, readinessAssessments, plans, activities, escalations } from '@/db/schema';
import {
  evaluateGuardrails,
  decidePublish,
  diffWeek,
  type Escalation,
  type PublishDecision,
} from '@/engine/plan';
import { getPlanWeek, publishPlan } from '@/db/plans';
import { addDays } from '@/engine/dates';

export interface AutopilotResult {
  mode: 'assisted' | 'autonomous';
  decision: PublishDecision;
  escalations: Escalation[];
  publishedPlanId: string | null;
}

export async function runAutopilot(
  db: DB,
  athleteId: string,
  opts: { today: string },
): Promise<AutopilotResult> {
  const { today } = opts;
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) throw new Error(`runAutopilot: athlete ${athleteId} not found`);
  const mode = athlete.coachingMode;

  // --- gather state ---
  const activeInjuries = await db
    .select()
    .from(injuryRecords)
    .where(eq(injuryRecords.athleteId, athleteId));
  const hasActiveInjury = activeInjuries.some((i) => i.status === 'acute' || i.status === 'returning');

  const recent = await db
    .select({ band: readinessAssessments.band, day: readinessAssessments.day })
    .from(readinessAssessments)
    .where(eq(readinessAssessments.athleteId, athleteId))
    .orderBy(desc(readinessAssessments.day))
    .limit(5);
  const recentReadinessBands = recent
    .map((r) => r.band)
    .filter((b): b is 'easy' | 'normal' | 'go' => b === 'easy' || b === 'normal' || b === 'go');

  const since = addDays(today, -3);
  const recentActivity = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startTime, new Date(`${since}T00:00:00Z`))))
    .limit(1);
  const hasRecentData = recent.some((r) => r.day >= since) || recentActivity.length > 0;

  // Candidate = the current-or-next draft week (earliest draft ending on/after
  // today). The published week for the same span is the diff baseline.
  const [draftPlan] = await db
    .select({ weekStart: plans.weekStart })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), eq(plans.status, 'draft'), gte(plans.weekEnd, today)))
    .orderBy(plans.weekStart)
    .limit(1);
  const targetWeek = draftPlan?.weekStart ?? null;
  const draft = targetWeek ? await getPlanWeek(db, athleteId, targetWeek, 'draft') : null;
  const published = targetWeek ? await getPlanWeek(db, athleteId, targetWeek, 'published') : null;
  const planTotalSessions = draft?.week.days.length ?? 0;
  const planChangedSessions =
    draft && published ? diffWeek(published.week, draft.week).changedCount : 0;

  // --- decide ---
  const guardrails = evaluateGuardrails({
    hasActiveInjury,
    recentReadinessBands,
    planChangedSessions,
    planTotalSessions,
    hasRecentData,
  });
  const decision = decidePublish(mode, guardrails);

  // --- act ---
  let publishedPlanId: string | null = null;
  if (decision === 'auto_publish' && draft) {
    await publishPlan(db, draft.planId);
    publishedPlanId = draft.planId;
  } else if (decision === 'hold_for_review') {
    await recordEscalations(db, athleteId, guardrails.escalations);
  }

  return { mode, decision, escalations: guardrails.escalations, publishedPlanId };
}

/** Insert escalations, skipping kinds already open for this athlete (dedupe). */
async function recordEscalations(db: DB, athleteId: string, list: Escalation[]): Promise<void> {
  if (list.length === 0) return;
  const open = await db
    .select({ kind: escalations.kind })
    .from(escalations)
    .where(and(eq(escalations.athleteId, athleteId), eq(escalations.status, 'open')));
  const openKinds = new Set(open.map((e) => e.kind));
  const fresh = list.filter((e) => !openKinds.has(e.kind));
  if (fresh.length === 0) return;
  await db.insert(escalations).values(
    fresh.map((e) => ({ athleteId, kind: e.kind, reason: e.reason })),
  );
}

export async function getOpenEscalations(db: DB, athleteId?: string) {
  const where = athleteId
    ? and(eq(escalations.status, 'open'), eq(escalations.athleteId, athleteId))
    : eq(escalations.status, 'open');
  return db.select().from(escalations).where(where).orderBy(desc(escalations.createdAt));
}
