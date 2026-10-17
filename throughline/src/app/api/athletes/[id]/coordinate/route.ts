/**
 * POST /api/athletes/[id]/coordinate — set the athlete's shared weekly-hours
 * budget and re-split it across their live run + bike goals, rebuilding both
 * plans to fit. Body: { weeklyHours: number, priority?: 'run' | 'bike' }.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { athleteToday } from '@/server/athleteToday';
import { resplitDualSeason } from '@/server/dualSeason';
import { guardAthleteWrite } from '@/server/apiAccess';
import { publicErrorMessage } from '@/lib/publicError';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { weeklyHours?: number; priority?: 'run' | 'bike' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  // Same floor as the tri/bike setups: a sub-1-hour budget splits to nothing and
  // rebuilds both plans as all-rest.
  if (!(Number(body.weeklyHours) >= 1)) {
    return NextResponse.json({ error: 'Enter your weekly training hours (at least 1).' }, { status: 400 });
  }
  const priority = body.priority === 'run' || body.priority === 'bike' ? body.priority : undefined;

  try {
    const db = await getDb();
    const res = await resplitDualSeason(db, id, (await athleteToday(id)), {
      weeklyHours: Number(body.weeklyHours),
      priority,
      publish: true,
    });
    return NextResponse.json({ ok: true, disciplines: res.disciplines, hours: res.hours, notes: res.notes });
  } catch (e) {
    return NextResponse.json({ error: publicErrorMessage(e, 'Failed.') }, { status: 422 });
  }
}
