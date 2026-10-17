/**
 * Manual Whoop sync trigger. Called by the ConnectWhoop component's "Sync now"
 * button. Pulls the last 14 days of data (safe to call repeatedly — idempotent).
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { syncWhoopData } from '@/server/whoop';
import { guardAthleteWrite } from '@/server/apiAccess';
import { publicErrorMessage } from '@/lib/publicError';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: athleteId } = await params;
  const denied = await guardAthleteWrite(athleteId);
  if (denied) return denied;

  try {
    const db = await getDb();
    // 30 days: enough to backfill recent workouts Whoop auto-detected.
    const result = await syncWhoopData(db, athleteId, 30);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const error = publicErrorMessage(e, 'Sync failed.');
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
