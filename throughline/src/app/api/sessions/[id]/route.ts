/**
 * POST /api/sessions/[id] — edit a planned session (pins it + logs an Override).
 * Body: { edits: SessionEdits, reasonCode: OverrideReason, note?: string }
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { editSession, getSessionAthleteId, type SessionEdits, type OverrideReason } from '@/server/sessionEdit';
import { guardAthleteConsole } from '@/server/apiAccess';

export const runtime = 'nodejs';

const REASONS: OverrideReason[] = [
  'too_aggressive',
  'too_cautious',
  'injury_judgment',
  'life_stress',
  'travel',
  'weather',
  'race_strategy',
  'athlete_request',
  'data_quality',
  'other',
];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { edits?: SessionEdits; reasonCode?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const reasonCode = body.reasonCode as OverrideReason;
  if (!REASONS.includes(reasonCode)) {
    return NextResponse.json({ error: 'A valid reason code is required.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const athleteId = await getSessionAthleteId(db, id);
    if (!athleteId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const denied = await guardAthleteConsole(db, athleteId);
    if (denied) return denied;
    await editSession(db, id, body.edits ?? {}, { reasonCode, note: body.note });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
