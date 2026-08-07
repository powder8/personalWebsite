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

/** The signed-in user as seen by a write guard (fields we key on). */
export interface WriteAccessUser {
  role?: string | null;
  /** The athlete this user IS (athletes only); null/absent for coaches/admins. */
  athleteId?: string | null;
  /** The console user id (coaches), for assignment checks. */
  id?: string | null;
}

/**
 * PURE decision for a console (coach/admin) route with no athlete in scope.
 * `viewer` is the resolved console viewer (null = not a console user). Set
 * adminOnly for endpoints the app restricts to the site owner (import, feedback).
 */
export function decideConsoleAccess(input: {
  configured: boolean;
  viewer: ConsoleViewer | null;
  adminOnly?: boolean;
}): 'allow' | 'forbid' {
  if (!input.configured) return 'allow'; // local dev / staged rollout
  if (!input.viewer) return 'forbid';
  if (input.adminOnly && input.viewer.kind !== 'admin') return 'forbid';
  return 'allow';
}

/**
 * PURE decision for "may this user WRITE to /api/athletes/[athleteId]?".
 *
 * `coachVisible` is the caller-supplied result of athleteVisibleTo for a coach
 * viewer (the DB lookup lives in the server shell). It's only consulted on the
 * coach branch, so callers may pass false when the user isn't a coach.
 */
export function decideAthleteWriteAccess(input: {
  configured: boolean;
  user: WriteAccessUser | null;
  athleteId: string;
  coachVisible: boolean;
}): 'allow' | 'forbid' {
  if (!input.configured) return 'allow'; // local dev / staged rollout
  const u = input.user;
  if (!u) return 'forbid';
  if (u.role === 'admin') return 'allow';
  if (u.athleteId && u.athleteId === input.athleteId) return 'allow'; // own data
  if (u.role === 'coach' && u.id && input.coachVisible) return 'allow';
  return 'forbid';
}
