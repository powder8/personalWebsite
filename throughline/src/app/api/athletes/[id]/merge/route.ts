/**
 * POST /api/athletes/[id]/merge — merge athlete [id] (source) INTO another.
 * Body: { intoAthleteId }. The source is deleted; all its data moves to target.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { mergeAthletes } from '@/server/mergeAthletes';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { intoAthleteId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.intoAthleteId) {
    return NextResponse.json({ error: 'intoAthleteId is required.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const result = await mergeAthletes(db, id, body.intoAthleteId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Merge failed.' }, { status: 422 });
  }
}
