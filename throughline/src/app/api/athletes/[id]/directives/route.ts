/**
 * POST /api/athletes/[id]/directives — create a windowed adjustment.
 * Body: { type, from, to?, deltaSecPerMile?, factor?, label? }
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createDirective, type NewDirective } from '@/server/directives';
import type { AdjustmentType } from '@/engine/plan';

export const runtime = 'nodejs';

const TYPES: AdjustmentType[] = ['pace_adjust', 'reduce_volume', 'unavailable'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Partial<NewDirective>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.type || !TYPES.includes(body.type)) {
    return NextResponse.json({ error: 'A valid adjustment type is required.' }, { status: 400 });
  }
  if (!body.from) {
    return NextResponse.json({ error: 'A start date is required.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    await createDirective(db, id, {
      type: body.type,
      from: body.from,
      to: body.to ?? null,
      deltaSecPerMile: body.deltaSecPerMile,
      factor: body.factor,
      label: body.label,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
