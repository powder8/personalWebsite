/**
 * POST /api/directives/[id] — deactivate (remove) a directive.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { deactivateDirective } from '@/server/directives';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const db = await getDb();
    await deactivateDirective(db, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
