/**
 * POST /api/athletes/[id]/chat — answer a training question, grounded in the
 * athlete's own data. Body: { messages: [{ role, content }] }.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { askTrainingQuestion, chatConfigured, type ChatMessage } from '@/server/chat';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!chatConfigured()) {
    return NextResponse.json({ error: 'Chat isn’t configured yet (no Anthropic API key).' }, { status: 503 });
  }
  let body: { messages?: ChatMessage[]; audience?: 'coach' | 'athlete' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const messages = (body.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
  );
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'A user message is required.' }, { status: 400 });
  }
  const audience = body.audience === 'coach' ? 'coach' : 'athlete';
  try {
    const db = await getDb();
    const { reply, actions } = await askTrainingQuestion(db, id, messages, { audience });
    return NextResponse.json({ ok: true, reply, actions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Chat failed.' }, { status: 422 });
  }
}
