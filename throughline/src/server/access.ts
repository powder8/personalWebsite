import 'server-only';
/**
 * Console access helpers: who is looking at the console, and which athletes
 * may they see? Pure rules live in accessLogic.ts; this file resolves the
 * viewer from the session and applies the rules against the DB.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes } from '@/db/schema';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { athleteVisibleTo, type ConsoleViewer } from '@/server/accessLogic';

export type { ConsoleViewer } from '@/server/accessLogic';
export { athleteVisibleTo } from '@/server/accessLogic';

/**
 * Resolve the console viewer from the session. Null = not a console user
 * (middleware should have blocked them already — treat as forbidden).
 * Local dev without auth acts as admin so everything stays visible.
 */
export async function consoleViewer(): Promise<ConsoleViewer | null> {
  if (!authConfigured()) return { kind: 'admin' };
  const session = await auth();
  const role = session?.user?.role;
  if (role === 'admin') return { kind: 'admin' };
  if (role === 'coach' && session?.user?.id) return { kind: 'coach', userId: session.user.id };
  return null;
}

/** Whether a single athlete is visible to the viewer (for deep-link guards). */
export async function athleteVisible(db: DB, viewer: ConsoleViewer, athleteId: string): Promise<boolean> {
  if (viewer.kind === 'admin') return true;
  const [row] = await db
    .select({ coachUserId: athletes.coachUserId })
    .from(athletes)
    .where(eq(athletes.id, athleteId))
    .limit(1);
  if (!row) return false;
  return athleteVisibleTo(viewer, row.coachUserId);
}

/**
 * The athlete-id set this viewer may see, or null for "unrestricted" (admin).
 * Null (not a full set) so admin queries skip the filter entirely.
 */
export async function visibleAthleteIds(db: DB, viewer: ConsoleViewer): Promise<Set<string> | null> {
  if (viewer.kind === 'admin') return null;
  const rows = await db
    .select({ id: athletes.id, coachUserId: athletes.coachUserId })
    .from(athletes)
    .where(eq(athletes.active, true));
  return new Set(rows.filter((r) => athleteVisibleTo(viewer, r.coachUserId)).map((r) => r.id));
}
