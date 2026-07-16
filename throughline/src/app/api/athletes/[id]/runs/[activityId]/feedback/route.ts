/**
 * POST /api/athletes/[id]/runs/[activityId]/feedback — the athlete's own
 * post-run read ("how did it feel?"). Feeds the run debrief. Athlete-owned
 * (gated by the /api/athletes/[id] ownership check in middleware).
 */
import { NextResponse } from 'next/server';
import { saveRunFeedback, type RunFeedbackInput } from '@/server/runDebrief';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string; activityId: string }> }) {
  const { id, activityId } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: RunFeedbackInput;
  try {
    body = (await req.json()) as RunFeedbackInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    await saveRunFeedback(id, activityId, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
