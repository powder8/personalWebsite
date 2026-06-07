/**
 * Merge one athlete into another: reassign all of the source athlete's records
 * to the target, then delete the source. Useful when multi-file imports create
 * duplicate athletes (e.g. different name/email for the same person).
 *
 * Explicit per-table updates (rather than a dynamic loop) keep this type-safe.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  athletes,
  intakeProfiles,
  connectedAccounts,
  rawEvents,
  activities,
  dailySummaries,
  sleepRecords,
  hrvRecords,
  restingHrRecords,
  checkIns,
  baselines,
  fitnessFatigueStates,
  plans,
  plannedSessions,
  directives,
  injuryRecords,
  athleteNotes,
  overrides,
  readinessAssessments,
  races,
  escalations,
} from '@/db/schema';

export interface MergeResult {
  sourceName: string;
  targetName: string;
}

export async function mergeAthletes(db: DB, sourceId: string, targetId: string): Promise<MergeResult> {
  if (sourceId === targetId) throw new Error('Cannot merge an athlete into itself.');
  const [source] = await db.select().from(athletes).where(eq(athletes.id, sourceId)).limit(1);
  const [target] = await db.select().from(athletes).where(eq(athletes.id, targetId)).limit(1);
  if (!source) throw new Error('Source athlete not found.');
  if (!target) throw new Error('Target athlete not found.');

  const reassign = { athleteId: targetId };
  await db.update(intakeProfiles).set(reassign).where(eq(intakeProfiles.athleteId, sourceId));
  await db.update(connectedAccounts).set(reassign).where(eq(connectedAccounts.athleteId, sourceId));
  await db.update(rawEvents).set(reassign).where(eq(rawEvents.athleteId, sourceId));
  await db.update(activities).set(reassign).where(eq(activities.athleteId, sourceId));
  await db.update(dailySummaries).set(reassign).where(eq(dailySummaries.athleteId, sourceId));
  await db.update(sleepRecords).set(reassign).where(eq(sleepRecords.athleteId, sourceId));
  await db.update(hrvRecords).set(reassign).where(eq(hrvRecords.athleteId, sourceId));
  await db.update(restingHrRecords).set(reassign).where(eq(restingHrRecords.athleteId, sourceId));
  await db.update(checkIns).set(reassign).where(eq(checkIns.athleteId, sourceId));
  await db.update(baselines).set(reassign).where(eq(baselines.athleteId, sourceId));
  await db.update(fitnessFatigueStates).set(reassign).where(eq(fitnessFatigueStates.athleteId, sourceId));
  await db.update(plans).set(reassign).where(eq(plans.athleteId, sourceId));
  await db.update(plannedSessions).set(reassign).where(eq(plannedSessions.athleteId, sourceId));
  await db.update(directives).set(reassign).where(eq(directives.athleteId, sourceId));
  await db.update(injuryRecords).set(reassign).where(eq(injuryRecords.athleteId, sourceId));
  await db.update(athleteNotes).set(reassign).where(eq(athleteNotes.athleteId, sourceId));
  await db.update(overrides).set(reassign).where(eq(overrides.athleteId, sourceId));
  await db.update(readinessAssessments).set(reassign).where(eq(readinessAssessments.athleteId, sourceId));
  await db.update(races).set(reassign).where(eq(races.athleteId, sourceId));
  await db.update(escalations).set(reassign).where(eq(escalations.athleteId, sourceId));

  await db.delete(athletes).where(eq(athletes.id, sourceId));
  return { sourceName: source.fullName, targetName: target.fullName };
}
