/**
 * POST /api/athletes/[id]/body-status — the athlete answers the body-status
 * question or reports how they are: { action }.
 *   sick_mild | sick_systemic | tired | fine | better | resume | progress
 * The plan's automatic adjustments are rewritten to match before we respond.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { guardAthleteWrite } from '@/server/apiAccess';
import { athleteToday } from '@/server/athleteToday';
import { recordAthleteAction } from '@/server/bodyStatus';
import { refreshAthleteHealth } from '@/server/healthRefresh';
import { publicErrorMessage } from '@/lib/publicError';

export const runtime = 'nodejs';

const ACTIONS = new Set(['sick_mild', 'sick_systemic', 'tired', 'fine', 'better', 'resume', 'progress']);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (!body?.action || !ACTIONS.has(body.action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const today = await athleteToday(id);
    await recordAthleteAction(db, id, today, body.action as Parameters<typeof recordAthleteAction>[3]);
    // Readiness for today follows the new state.
    const health = await refreshAthleteHealth(db, id, today);
    return NextResponse.json({ ok: true, status: health.body?.status ?? null });
  } catch (e) {
    return NextResponse.json({ error: publicErrorMessage(e, 'Could not save that. Try again.') }, { status: 422 });
  }
}
