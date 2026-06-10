/**
 * POST /api/athletes/[id]/strength — set the endurance↔speed strength bias.
 * Body: { bias: number }  (-1 endurance … +1 speed)
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setStrengthBias } from '@/server/paceAdjust';
import { todayISO } from '@/server/console';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { bias?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const bias = Number(body.bias);
  if (!Number.isFinite(bias)) {
    return NextResponse.json({ error: 'bias must be a number in [-1, 1].' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const result = await setStrengthBias(db, id, bias, { today: todayISO() });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
