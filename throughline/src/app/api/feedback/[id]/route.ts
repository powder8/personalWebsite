/**
 * POST /api/feedback/[id] — set a feedback item's status. Body: { status }
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setFeedbackStatus, type FeedbackStatus } from '@/server/feedback';
import { guardConsole } from '@/server/apiAccess';

export const runtime = 'nodejs';

const VALID: FeedbackStatus[] = ['open', 'addressed'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardConsole({ adminOnly: true });
  if (denied) return denied;

  const { id } = await ctx.params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const status = body.status as FeedbackStatus;
  if (!VALID.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${VALID.join(', ')}` }, { status: 400 });
  }
  try {
    const db = await getDb();
    await setFeedbackStatus(db, id, status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
