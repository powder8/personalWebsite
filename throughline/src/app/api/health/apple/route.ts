/**
 * POST /api/health/apple — Apple Health push ingest. Authenticated by a per-
 * athlete bearer TOKEN (see server/appleHealth.ts), NOT a browser session: an
 * on-device iOS exporter (Health Auto Export REST automation) posts here.
 *
 *   Authorization: Bearer <token>
 *   Content-Type: application/json
 *   body: the exporter's { data: { metrics: [...] } } payload
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { findAthleteIdByAppleToken, ingestAppleHealth } from '@/server/appleHealth';

export const runtime = 'nodejs';

const MAX_BYTES = 4 * 1024 * 1024; // generous for a multi-day export, bounded

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const db = await getDb();
  const athleteId = await findAthleteIdByAppleToken(db, token);
  if (!athleteId) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 401 });
  }

  try {
    const res = await ingestAppleHealth(db, athleteId, payload);
    return NextResponse.json({ ok: true, ...res });
  } catch {
    // Never echo payload contents (health PII) back in an error.
    return NextResponse.json({ error: 'Ingest failed.' }, { status: 500 });
  }
}
