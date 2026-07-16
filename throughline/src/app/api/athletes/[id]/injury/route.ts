/**
 * POST /api/athletes/[id]/injury — the athlete-driven injury lifecycle.
 * Body: { action, ... }
 *   report     { bodyPart, canContinue, note?, checkBackDays? }
 *   resume     { injuryId }   — "ready to test an easy run"
 *   still_hurt { injuryId, checkBackDays }
 *   clear      { injuryId }
 * No treatment advice anywhere — we only pause, ask, and ramp back.
 * Ownership is enforced by middleware for /api/athletes/<id>.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { todayISO } from '@/server/console';
import { reportInjury, resumeInjury, pushCheckBack, clearInjury } from '@/server/injury';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: {
    action?: string;
    bodyPart?: string;
    canContinue?: boolean;
    note?: string;
    checkBackDays?: number;
    injuryId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const db = await getDb();
  const today = todayISO();
  try {
    switch (body.action) {
      case 'report':
        if (!body.bodyPart?.trim()) return NextResponse.json({ error: 'What hurts?' }, { status: 400 });
        await reportInjury(db, id, today, {
          bodyPart: body.bodyPart.trim(),
          canContinue: body.canContinue === true,
          note: body.note,
          checkBackDays: body.checkBackDays,
        });
        break;
      case 'resume':
        if (!body.injuryId) return NextResponse.json({ error: 'injuryId required' }, { status: 400 });
        await resumeInjury(db, id, body.injuryId, today);
        break;
      case 'still_hurt':
        if (!body.injuryId) return NextResponse.json({ error: 'injuryId required' }, { status: 400 });
        await pushCheckBack(db, id, body.injuryId, today, body.checkBackDays ?? 7);
        break;
      case 'clear':
        if (!body.injuryId) return NextResponse.json({ error: 'injuryId required' }, { status: 400 });
        await clearInjury(db, id, body.injuryId, today);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 500 });
  }
}
