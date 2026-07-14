/**
 * POST /api/admin/rebuild-plans — coach-only. Regenerates every active
 * athlete's plan from their CURRENT state (goal, anchor, existing volume) so
 * they pick up engine changes like the new workout library. For each athlete
 * with an active plan we drop their plans and re-run the same coverage path the
 * portal uses (ensureSeasonCoverage), which rebuilds and republishes per their
 * coaching mode.
 *
 * Safe: only touches athletes who already have a current plan; skips the rest.
 * Plans are derived data (re-derivable), so this is non-destructive to raw data.
 */
import { NextResponse } from 'next/server';
import { and, eq, gte } from 'drizzle-orm';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { getDb } from '@/db';
import { athletes, plans } from '@/db/schema';
import { ensureSeasonCoverage } from '@/server/seasonCoverage';
import { todayISO } from '@/server/console';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  // Admin-only: this wipes and rebuilds EVERY athlete's plan, so it is not a
  // coach action. (When auth is unconfigured — local dev — allow it.)
  if (authConfigured()) {
    const session = await auth();
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
    }
  }

  const db = await getDb();
  const today = todayISO();
  const list = await db
    .select({ id: athletes.id, name: athletes.fullName })
    .from(athletes)
    .where(eq(athletes.active, true));

  const results: { name: string; status?: string; generated?: boolean; published?: number; skipped?: string; error?: string }[] = [];

  for (const a of list) {
    try {
      // Only rebuild athletes who currently have a live plan (week still ahead).
      const active = await db
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.athleteId, a.id), gte(plans.weekEnd, today)))
        .limit(1);
      if (active.length === 0) {
        results.push({ name: a.name, skipped: 'no active plan' });
        continue;
      }
      await db.delete(plans).where(eq(plans.athleteId, a.id)); // cascades planned_sessions
      const r = await ensureSeasonCoverage(db, a.id, today);
      results.push({ name: a.name, status: r.status, generated: r.generated, published: r.published });
    } catch (e) {
      results.push({ name: a.name, error: e instanceof Error ? e.message : 'failed' });
    }
  }

  const rebuilt = results.filter((r) => r.generated).length;
  return NextResponse.json({ ok: true, athletes: list.length, rebuilt, results });
}
