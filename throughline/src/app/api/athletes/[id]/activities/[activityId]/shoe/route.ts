/**
 * POST /api/athletes/[id]/activities/[activityId]/shoe — reassign a run to a
 * pair of shoes (or clear it). Body: { shoeId: string | null }.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { assignActivityShoe } from '@/server/shoes';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string; activityId: string }> }) {
  const { id, activityId } = await ctx.params;
  let body: { shoeId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    await assignActivityShoe(db, id, activityId, body.shoeId ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
