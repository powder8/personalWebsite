/**
 * POST /api/athletes/[id]/anchor — set the fitness anchor.
 * Body (one of):
 *   { kind: 'vdot', vdot }
 *   { kind: 'race', distanceMeters, timeSeconds }
 *   { kind: 'threshold', thresholdSecPerKm }
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setAnchor, type AnchorInput } from '@/server/anchor';
import { todayISO } from '@/server/console';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: AnchorInput;
  try {
    body = (await req.json()) as AnchorInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const result = await setAnchor(db, id, body, { today: todayISO() });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
