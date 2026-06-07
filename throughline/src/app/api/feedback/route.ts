/**
 * POST /api/feedback — leave a piece of feedback.
 * Body: { author?, path?, category?, body }
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createFeedback } from '@/server/feedback';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { author?: string; path?: string; category?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const message = body.body?.trim();
  if (!message) {
    return NextResponse.json({ error: 'Please include a message.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    await createFeedback(db, { author: body.author, path: body.path, category: body.category, body: message });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
