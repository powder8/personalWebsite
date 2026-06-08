/**
 * POST /api/athletes/[id]/cycle — save opt-in menstrual cycle settings.
 * Body: { enabled, lastStartDate, avgCycleDays, avgPeriodDays }.
 * Sensitive health data: only written when the athlete opts in.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setCycle, type CycleSettings } from '@/server/cycle';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Partial<CycleSettings>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    await setCycle(db, id, {
      enabled: !!body.enabled,
      lastStartDate: body.lastStartDate || null,
      avgCycleDays: Number(body.avgCycleDays) || 28,
      avgPeriodDays: Number(body.avgPeriodDays) || 5,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
