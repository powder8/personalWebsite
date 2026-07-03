/**
 * Manual Whoop sync trigger. Called by the ConnectWhoop component's "Sync now"
 * button. Pulls the last 14 days of data (safe to call repeatedly — idempotent).
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { syncWhoopData } from '@/server/whoop';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: athleteId } = await params;
  try {
    const db = await getDb();
    const result = await syncWhoopData(db, athleteId, 14);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Sync failed.';
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
