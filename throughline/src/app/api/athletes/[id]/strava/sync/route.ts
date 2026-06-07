/**
 * POST /api/athletes/[id]/strava/sync — pull the athlete's latest Strava
 * activities on demand ("Sync now"). Idempotent.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { syncStravaActivities } from '@/server/strava';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const db = await getDb();
    const result = await syncStravaActivities(db, id, { fallbackDays: 365 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed.' }, { status: 422 });
  }
}
