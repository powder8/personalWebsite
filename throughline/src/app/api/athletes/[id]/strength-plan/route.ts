/**
 * POST /api/athletes/[id]/strength-plan — set supporting strength cadence
 * (0–4 sessions/week) and lay strength sessions over the plan horizon.
 * Body: { daysPerWeek: number }.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setupSupportingStrength } from '@/server/strengthSeason';
import { todayISO } from '@/server/console';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { daysPerWeek?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const daysPerWeek = Number(body.daysPerWeek);
  if (!Number.isFinite(daysPerWeek) || daysPerWeek < 0 || daysPerWeek > 4) {
    return NextResponse.json({ error: 'daysPerWeek must be between 0 and 4.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const res = await setupSupportingStrength(db, id, todayISO(), { daysPerWeek });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
