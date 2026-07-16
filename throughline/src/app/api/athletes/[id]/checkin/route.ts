/**
 * POST /api/athletes/[id]/checkin — submit (or update) today's check-in.
 * Body: { day, soreness?, energy?, yesterdayRpe?, note? }
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { submitCheckIn } from '@/server/checkIn';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: {
    day?: string;
    soreness?: number | null;
    energy?: number | null;
    yesterdayRpe?: number | null;
    note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.day) {
    return NextResponse.json({ error: 'A day is required.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    await submitCheckIn(db, id, {
      day: body.day,
      soreness: body.soreness ?? null,
      energy: body.energy ?? null,
      yesterdayRpe: body.yesterdayRpe ?? null,
      note: body.note ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
