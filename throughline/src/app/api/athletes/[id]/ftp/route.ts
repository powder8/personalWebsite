/**
 * POST /api/athletes/[id]/ftp — update the athlete's cycling FTP and re-tune the
 * future rides in one shot (no full plan regeneration). Body: { ftpWatts: number }
 * pins an entered FTP; { mode: 'auto' } hands it back to ride power and
 * re-estimates now. Returns the FTP + how many rides were re-tuned.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { athleteToday } from '@/server/athleteToday';
import { setAthleteFtp } from '@/server/bikeAdjust';
import { guardAthleteWrite } from '@/server/apiAccess';
import { ensureAutoFtp, trackFtpFromRides } from '@/server/autoFtp';
import { publicErrorMessage } from '@/lib/publicError';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { ftpWatts?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (body.mode === 'auto') {
    try {
      const db = await getDb();
      await trackFtpFromRides(db, id);
      const res = await ensureAutoFtp(db, id, { today: (await athleteToday(id)) });
      return NextResponse.json({ ok: true, mode: 'auto', status: res.status, ftpWatts: res.ftpWatts, updatedSessions: res.updatedSessions ?? 0 });
    } catch (e) {
      return NextResponse.json({ error: publicErrorMessage(e, 'Failed.') }, { status: 422 });
    }
  }
  const ftpWatts = Number(body.ftpWatts);
  if (!(ftpWatts > 0) || ftpWatts > 600) {
    return NextResponse.json({ error: 'Enter your FTP in watts (a number up to 600).' }, { status: 422 });
  }
  try {
    const db = await getDb();
    const res = await setAthleteFtp(db, id, ftpWatts, { today: (await athleteToday(id)) });
    return NextResponse.json({ ok: true, ftpWatts: res.ftpWatts, updatedSessions: res.updatedSessions });
  } catch (e) {
    return NextResponse.json({ error: publicErrorMessage(e, 'Failed.') }, { status: 422 });
  }
}
