/**
 * POST   /api/athletes/[id]/directives — create a windowed adjustment.
 *        Body: { type, from, to?, deltaSecPerMile?, factor?, label? }
 * DELETE /api/athletes/[id]/directives?directiveId=... — lift one.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  createDirective,
  deactivateDirective,
  getDirectiveAthleteId,
  type NewDirective,
} from '@/server/directives';
import type { AdjustmentType } from '@/engine/plan';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

const TYPES: AdjustmentType[] = ['pace_adjust', 'reduce_volume', 'unavailable'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

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

/**
 * DELETE /api/athletes/[id]/directives?directiveId=... — lift an adjustment.
 * Without this an open-ended "can't train" pause is permanent: it turns every
 * planned day into rest at render time, and rebuilding the plan can't clear it
 * because directives live outside the plan.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  const directiveId = new URL(req.url).searchParams.get('directiveId');
  if (!directiveId) return NextResponse.json({ error: 'Missing directiveId.' }, { status: 400 });

  const db = await getDb();
  // Never let one athlete lift another's adjustment.
  const owner = await getDirectiveAthleteId(db, directiveId);
  if (owner !== id) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  await deactivateDirective(db, directiveId);
  return NextResponse.json({ ok: true });
}
