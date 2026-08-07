/**
 * POST /api/directives/[id]/status — coach approves/declines a proposed
 * (assisted-mode) adaptation. Body: { action: 'approve' | 'decline' }.
 * Admin, or the coach ASSIGNED to the directive's athlete, only. Approving
 * flips the directive active so it applies to the athlete's plan; declining
 * leaves the plan unchanged.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { approveDirective, declineDirective, getDirectiveAthleteId } from '@/server/directives';
import { guardAthleteConsole } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const db = await getDb();
  const athleteId = await getDirectiveAthleteId(db, id);
  if (!athleteId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const denied = await guardAthleteConsole(db, athleteId);
  if (denied) return denied;
  try {
    if (body.action === 'approve') await approveDirective(db, id);
    else if (body.action === 'decline') await declineDirective(db, id);
    else return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 500 });
  }
}
