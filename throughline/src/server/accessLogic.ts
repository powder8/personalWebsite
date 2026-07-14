/**
 * PURE console access-scoping rules (no DB, no auth import — testable).
 *
 * The model: admins see every athlete; a coach sees the athletes ASSIGNED to
 * them (athletes.coachUserId) plus UNASSIGNED athletes. Unassigned-visible is
 * deliberate — assignment is new, and a strict rule would empty every coach's
 * roster until an admin assigns everyone. Tighten here when that day comes.
 */

export type ConsoleViewer = { kind: 'admin' } | { kind: 'coach'; userId: string };

export function athleteVisibleTo(viewer: ConsoleViewer, coachUserId: string | null): boolean {
  if (viewer.kind === 'admin') return true;
  return coachUserId == null || coachUserId === viewer.userId;
}
