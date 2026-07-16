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
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { athleteVisible } from '@/server/access';
import { decideAthleteWriteAccess } from '@/server/accessLogic';

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
  return decision === 'allow' ? null : NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
}
