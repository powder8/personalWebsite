/**
 * POST /api/athletes/[id]/goal — athlete sets their goal + we generate a plan.
 * Body: AthleteGoalInput. Uses TODAY as the build start.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setupAthleteGoal, type AthleteGoalInput } from '@/server/athleteGoal';
import { todayISO } from '@/server/console';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: AthleteGoalInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const { weeks } = await setupAthleteGoal(db, id, todayISO(), body);
    return NextResponse.json({ ok: true, weeks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
