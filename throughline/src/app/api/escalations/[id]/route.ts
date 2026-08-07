/**
 * POST /api/escalations/[id] — transition an escalation's status.
 * Body: { status: 'open' | 'acknowledged' | 'resolved' }.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getEscalationAthleteId, setEscalationStatus, type EscalationStatus } from '@/server/escalations';
import { guardAthleteConsole } from '@/server/apiAccess';

export const runtime = 'nodejs';

const VALID: EscalationStatus[] = ['open', 'acknowledged', 'resolved'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const status = body.status as EscalationStatus;
  if (!VALID.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${VALID.join(', ')}` }, { status: 400 });
  }
  try {
    const db = await getDb();
    const athleteId = await getEscalationAthleteId(db, id);
    if (!athleteId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const denied = await guardAthleteConsole(db, athleteId);
    if (denied) return denied;
    await setEscalationStatus(db, id, status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
