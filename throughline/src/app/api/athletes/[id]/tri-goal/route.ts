/**
 * POST /api/athletes/[id]/tri-goal — athlete sets up a TRIATHLON goal (anchors +
 * target finish + hours + limiter) and we generate + publish a multi-sport plan.
 * Body: TriGoalInput. Returns the honest binding-leg verdict for instant feedback.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setupAthleteTriGoal, type TriGoalInput } from '@/server/athleteTriGoal';
import { todayISO } from '@/server/console';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: TriGoalInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const res = await setupAthleteTriGoal(db, id, todayISO(), body);
    return NextResponse.json({
      ok: true,
      weeksPerSport: res.weeksPerSport,
      verdict: res.feasibility?.verdict ?? null,
      headline: res.feasibility?.headline ?? null,
      note: res.feasibility?.note ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
