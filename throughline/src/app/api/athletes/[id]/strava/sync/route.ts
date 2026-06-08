/**
 * POST /api/athletes/[id]/strava/sync — pull the athlete's latest Strava
 * activities on demand ("Sync now"). Idempotent.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { syncStravaActivities } from '@/server/strava';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // ?full=1 re-pulls the whole history (refreshes existing rows, e.g. titles).
  const full = new URL(req.url).searchParams.get('full') === '1';
  try {
    const db = await getDb();
    const result = await syncStravaActivities(db, id, { fallbackDays: full ? 3650 : 365, full });
    return NextResponse.json({ ok: true, full, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed.' }, { status: 422 });
  }
}
