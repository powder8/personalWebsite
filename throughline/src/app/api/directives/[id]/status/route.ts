/**
 * POST /api/directives/[id]/status — coach approves/declines a proposed
 * (assisted-mode) adaptation. Body: { action: 'approve' | 'decline' }.
 * Coach/admin only. Approving flips the directive active so it applies to the
 * athlete's plan; declining leaves the plan unchanged.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { approveDirective, declineDirective } from '@/server/directives';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (authConfigured()) {
    const session = await auth();
    const role = session?.user?.role;
    if (role !== 'coach' && role !== 'admin') {
      return NextResponse.json({ error: 'Coach only.' }, { status: 403 });
    }
  }
  const { id } = await ctx.params;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const db = await getDb();
  try {
    if (body.action === 'approve') await approveDirective(db, id);
    else if (body.action === 'decline') await declineDirective(db, id);
    else return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 500 });
  }
}
