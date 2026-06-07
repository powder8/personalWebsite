/**
 * Per-session plan edit (Phase 4 plan editor).
 *
 * A coach edits one planned session. Per the architecture: a direct session
 * edit is allowed but it PINS the session (so replanning + pace re-apply route
 * around it) and is captured as an Override with a reason code — labeled data.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { plannedSessions, overrides } from '@/db/schema';
import { midpoint } from '@/engine/plan';

const MI_TO_M = 1609.344;
const MI_TO_KM = 1.609344;

export type SessionType = (typeof plannedSessions.$inferSelect)['sessionType'];

export interface SessionEdits {
  distanceMiles?: number;
  sessionType?: SessionType;
  description?: string;
  paceFastSecPerMile?: number;
  paceSlowSecPerMile?: number;
}

export type OverrideReason =
  | 'too_aggressive'
  | 'too_cautious'
  | 'injury_judgment'
  | 'life_stress'
  | 'travel'
  | 'weather'
  | 'race_strategy'
  | 'athlete_request'
  | 'data_quality'
  | 'other';

function snapshot(s: typeof plannedSessions.$inferSelect) {
  return {
    sessionType: s.sessionType,
    zone: s.zone,
    distanceMeters: s.targetDistanceMeters,
    paceFast: s.targetPaceFastSecPerKm,
    paceSlow: s.targetPaceSlowSecPerKm,
    description: s.description,
    pinned: s.pinned,
  };
}

export async function editSession(
  db: DB,
  sessionId: string,
  edits: SessionEdits,
  opts: { reasonCode: OverrideReason; note?: string; createdBy?: string },
): Promise<void> {
  const [s] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, sessionId)).limit(1);
  if (!s) throw new Error(`editSession: session ${sessionId} not found`);

  const before = snapshot(s);
  const set: Partial<typeof plannedSessions.$inferInsert> = { pinned: true };

  if (edits.distanceMiles != null && Number.isFinite(edits.distanceMiles)) {
    set.targetDistanceMeters = edits.distanceMiles * MI_TO_M;
  }
  if (edits.sessionType) set.sessionType = edits.sessionType;
  if (edits.description != null) set.description = edits.description;

  const fast = edits.paceFastSecPerMile;
  const slow = edits.paceSlowSecPerMile;
  if (fast != null && Number.isFinite(fast)) set.targetPaceFastSecPerKm = fast / MI_TO_KM;
  if (slow != null && Number.isFinite(slow)) set.targetPaceSlowSecPerKm = slow / MI_TO_KM;
  if (set.targetPaceFastSecPerKm != null && set.targetPaceSlowSecPerKm != null) {
    set.targetPaceSecPerKm = midpoint({
      fastSecPerKm: set.targetPaceFastSecPerKm as number,
      slowSecPerKm: set.targetPaceSlowSecPerKm as number,
    });
  }

  await db.update(plannedSessions).set(set).where(eq(plannedSessions.id, sessionId));

  const [updated] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, sessionId)).limit(1);
  await db.insert(overrides).values({
    athleteId: s.athleteId,
    targetType: 'planned_session',
    targetId: sessionId,
    before,
    after: snapshot(updated),
    reasonCode: opts.reasonCode,
    note: opts.note ?? null,
    createdBy: opts.createdBy ?? 'coach',
  });
}
