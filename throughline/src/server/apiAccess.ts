import 'server-only';
/**
 * Write-guard for /api/athletes/[id]/* routes.
 *
 * Middleware (auth.config.ts) only gates these paths by ROLE: an athlete is
 * pinned to their own id, but any coach or admin is let through to every
 * athlete. Coach→athlete ASSIGNMENT can't be checked in the edge middleware
 * (no DB), so it's enforced here, at the data layer, on each write.
 *
 * Returns a 403 Response to return early, or null when the caller may proceed:
 *   - dev (auth unconfigured): allow — local console acts as admin.
 *   - the athlete themselves: allow their own id (defence in depth; middleware
 *     already pins them).
 *   - admin: allow any athlete.
 *   - coach: allow only assigned (or still-unassigned) athletes.
 */
import type { DB } from '@/db';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { athleteVisible, consoleViewer } from '@/server/access';
import { decideAthleteWriteAccess, decideConsoleAccess } from '@/server/accessLogic';

function forbidden(): Response {
  return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
}

/**
 * Guard a console (coach/admin) route with no athlete in scope — feedback list,
 * bulk import, etc. Pass adminOnly for endpoints the app restricts to the site
 * owner (mirrors the admin-gated /import and /feedback pages).
 */
export async function guardConsole(opts?: { adminOnly?: boolean }): Promise<Response | null> {
  const configured = authConfigured();
  const viewer = configured ? await consoleViewer() : null;
  return decideConsoleAccess({ configured, viewer, adminOnly: opts?.adminOnly }) === 'allow' ? null : forbidden();
}

/**
 * Guard a console route scoped to ONE athlete's resource (an escalation, a
 * planned session, a directive): admin, or a coach ASSIGNED to that athlete.
 * Unlike guardAthleteWrite this does NOT admit the athlete themselves — these
 * are coach actions on the athlete's plan, not self-service.
 */
export async function guardAthleteConsole(db: DB, athleteId: string): Promise<Response | null> {
  if (!authConfigured()) return null;
  const viewer = await consoleViewer();
  if (!viewer) return forbidden();
  return (await athleteVisible(db, viewer, athleteId)) ? null : forbidden();
}

export async function guardAthleteWrite(athleteId: string): Promise<Response | null> {
  const configured = authConfigured();
  const user = configured ? ((await auth())?.user ?? null) : null;

  // The coach-assignment lookup is the only DB hit; skip it unless needed.
  let coachVisible = false;
  if (user?.role === 'coach' && user.id) {
    const db = await getDb();
    coachVisible = await athleteVisible(db, { kind: 'coach', userId: user.id }, athleteId);
  }

  const decision = decideAthleteWriteAccess({ configured, user, athleteId, coachVisible });
  return decision === 'allow' ? null : forbidden();
}
