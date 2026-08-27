/**
 * POST /api/athletes/[id]/ftp — update the athlete's cycling FTP and re-tune the
 * future rides in one shot (no full plan regeneration). Body: { ftpWatts: number }.
 * Returns the new FTP + how many rides were re-tuned.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setAthleteFtp } from '@/server/bikeAdjust';
import { todayISO } from '@/server/console';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { ftpWatts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const ftpWatts = Number(body.ftpWatts);
  if (!(ftpWatts > 0) || ftpWatts > 600) {
    return NextResponse.json({ error: 'Enter your FTP in watts (a number up to 600).' }, { status: 422 });
  }
  try {
    const db = await getDb();
    const res = await setAthleteFtp(db, id, ftpWatts, { today: todayISO() });
    return NextResponse.json({ ok: true, ftpWatts: res.ftpWatts, updatedSessions: res.updatedSessions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
