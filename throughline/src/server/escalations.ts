/**
 * Escalation review: list the autopilot's open/acknowledged escalations for a
 * human to triage, and transition their status.
 *   open → acknowledged (someone's on it) → resolved
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { escalations, athletes } from '@/db/schema';

export type EscalationStatus = 'open' | 'acknowledged' | 'resolved';

export interface EscalationRow {
  id: string;
  athleteId: string;
  athleteName: string;
  kind: string;
  status: EscalationStatus;
  reason: string;
  createdAt: Date;
}

/** Active = open + acknowledged (resolved drop off the queue). */
export async function listEscalations(
  db: DB,
  statuses: EscalationStatus[] = ['open', 'acknowledged'],
): Promise<EscalationRow[]> {
  const rows = await db
    .select({
      id: escalations.id,
      athleteId: escalations.athleteId,
      athleteName: athletes.fullName,
      kind: escalations.kind,
      status: escalations.status,
      reason: escalations.reason,
      createdAt: escalations.createdAt,
    })
    .from(escalations)
    .innerJoin(athletes, eq(escalations.athleteId, athletes.id))
    .where(inArray(escalations.status, statuses))
    .orderBy(desc(escalations.createdAt));
  return rows as EscalationRow[];
}

export async function listEscalationsForAthlete(db: DB, athleteId: string): Promise<EscalationRow[]> {
  const rows = await db
    .select({
      id: escalations.id,
      athleteId: escalations.athleteId,
      athleteName: athletes.fullName,
      kind: escalations.kind,
      status: escalations.status,
      reason: escalations.reason,
      createdAt: escalations.createdAt,
    })
    .from(escalations)
    .innerJoin(athletes, eq(escalations.athleteId, athletes.id))
    .where(and(eq(escalations.athleteId, athleteId), inArray(escalations.status, ['open', 'acknowledged'])))
    .orderBy(desc(escalations.createdAt));
  return rows as EscalationRow[];
}

export async function setEscalationStatus(
  db: DB,
  id: string,
  status: EscalationStatus,
): Promise<void> {
  await db
    .update(escalations)
    .set({ status, resolvedAt: status === 'resolved' ? new Date() : null })
    .where(eq(escalations.id, id));
}

export async function countActiveEscalations(db: DB): Promise<number> {
  const rows = await db
    .select({ id: escalations.id })
    .from(escalations)
    .where(inArray(escalations.status, ['open', 'acknowledged']));
  return rows.length;
}

export const ESCALATION_LABELS: Record<string, string> = {
  active_injury: 'Active injury',
  repeated_low_readiness: 'Repeated low readiness',
  large_plan_change: 'Large plan change',
  stale_data: 'Stale data',
  other: 'Other',
};
