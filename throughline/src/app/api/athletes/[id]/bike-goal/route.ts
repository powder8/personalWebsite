/**
 * POST /api/athletes/[id]/bike-goal — athlete sets up a standalone CYCLING goal
 * (FTP + event + hours) and we generate + publish a bike-only plan.
 * Body: BikeGoalInput. Uses TODAY as the build start.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setupAthleteBikeGoal, type BikeGoalInput } from '@/server/athleteBikeGoal';
import { todayISO } from '@/server/console';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: BikeGoalInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const res = await setupAthleteBikeGoal(db, id, todayISO(), body);
    return NextResponse.json({ ok: true, weeks: res.weeks, peakTss: res.peakTss });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
