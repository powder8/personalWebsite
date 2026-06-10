/**
 * POST /api/athletes/[id]/strava/sync — pull the athlete's latest Strava
 * activities on demand ("Sync now"). Idempotent.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { syncStravaActivities } from '@/server/strava';
import { ensureAutoAnchor } from '@/server/anchor';
import { todayISO } from '@/server/console';

export const runtime = 'nodejs';
export const maxDuration = 60; // each call processes a bounded chunk; client loops until done

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  // ?full=1 starts a whole-history pull; ?after=<unix> continues a prior chunk.
  const full = url.searchParams.get('full') === '1';
  const afterParam = url.searchParams.get('after');
  const afterOverride = afterParam ? parseInt(afterParam, 10) : undefined;
  try {
    const db = await getDb();
    const result = await syncStravaActivities(db, id, {
      fallbackDays: full ? 3650 : 365,
      full,
      afterOverride,
      maxPages: 5,
    });
    // When the import finishes, default the fitness anchor from the best effort
    // (unless a human already set it). Best-effort; never blocks the sync.
    if (result.done) {
      try {
        await ensureAutoAnchor(db, id, { today: todayISO() });
      } catch {
        /* non-fatal */
      }
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed.' }, { status: 422 });
  }
}
