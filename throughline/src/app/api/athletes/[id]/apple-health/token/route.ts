/**
 * POST /api/athletes/[id]/apple-health/token — generate (or rotate) the athlete's
 * Apple Health ingest token. Session-authed (the athlete/coach). Returns the RAW
 * token once, plus the ingest URL to paste into the on-device exporter. Rotating
 * invalidates any previous token.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { rotateAppleHealthToken } from '@/server/appleHealth';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  try {
    const db = await getDb();
    const token = await rotateAppleHealthToken(db, id);
    const origin = new URL(req.url).origin;
    return NextResponse.json({ ok: true, token, ingestUrl: `${origin}/api/health/apple` });
  } catch {
    return NextResponse.json({ error: 'Could not generate a token.' }, { status: 500 });
  }
}
