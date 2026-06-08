/**
 * POST /api/athletes/[id]/profile — update editable athlete profile fields.
 * Currently: dateOfBirth (drives masters pace defaults / age-grading).
 * Body: { dateOfBirth: 'YYYY-MM-DD' | null }
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { dateOfBirth?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const dob = body.dateOfBirth ? String(body.dateOfBirth) : null;
  if (dob != null && !DATE_RE.test(dob)) {
    return NextResponse.json({ error: 'dateOfBirth must be YYYY-MM-DD.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    await db.update(athletes).set({ dateOfBirth: dob, updatedAt: new Date() }).where(eq(athletes.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
