/**
 * POST /api/athletes/[id]/chat — answer a training question, grounded in the
 * athlete's own data. Body: { messages: [{ role, content }] }.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { askTrainingQuestion, chatConfigured, type ChatMessage } from '@/server/chat';
import { guardAthleteWrite } from '@/server/apiAccess';
import { consumeRateLimit } from '@/server/rateLimit';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { publicErrorMessage } from '@/lib/publicError';

/** Each call is a paid model request: cap volume per athlete and input size. */
const CHAT_RATE = [
  { max: 30, windowMs: 60 * 60 * 1000 },
  { max: 150, windowMs: 24 * 60 * 60 * 1000 },
];
const MAX_MESSAGES = 20; // history sent to the model
const MAX_MESSAGE_CHARS = 4000;

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  if (!chatConfigured()) {
    return NextResponse.json({ error: 'Chat isn’t configured yet (no Anthropic API key).' }, { status: 503 });
  }
  let body: { messages?: ChatMessage[]; audience?: 'coach' | 'athlete' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'A user message is required.' }, { status: 400 });
  }
  // The coach persona is for the console only: take it from the session role,
  // never from the request body alone.
  let audience: 'coach' | 'athlete' = 'athlete';
  if (body.audience === 'coach') {
    const role = authConfigured() ? (await auth())?.user?.role : 'admin';
    if (role === 'coach' || role === 'admin') audience = 'coach';
  }
  try {
    const db = await getDb();
    const rate = await consumeRateLimit(db, `chat:${id}`, CHAT_RATE);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'You have sent a lot of messages. Try again a little later.' },
        { status: 429, headers: { 'retry-after': String(rate.retryAfterSec) } },
      );
    }
    const { reply, actions } = await askTrainingQuestion(db, id, messages, { audience });
    return NextResponse.json({ ok: true, reply, actions });
  } catch (e) {
    return NextResponse.json({ error: publicErrorMessage(e, 'Chat failed.') }, { status: 422 });
  }
}
