/**
 * POST /api/athletes/[id]/estimate-ftp — estimate FTP from the athlete's recent
 * Strava rides (best 20-min power × 0.95). Returns { ok, ftpWatts|null, ... };
 * a null ftpWatts means "no usable power data" (fall back to manual entry).
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { guardAthleteWrite } from '@/server/apiAccess';
import { estimateFtpFromStrava } from '@/server/strava';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  try {
    const db = await getDb();
    const est = await estimateFtpFromStrava(db, id);
    return NextResponse.json({ ok: true, ...(est ?? { ftpWatts: null }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Estimate failed.' }, { status: 422 });
  }
}
