/**
 * Strava push webhook.
 *
 *  GET  — subscription validation handshake: echo hub.challenge when the
 *         hub.verify_token matches our configured token.
 *  POST — event notification (object_type/object_id/aspect_type/owner_id). The
 *         body carries only ids, so we map owner → athlete and pull the
 *         activity, running it through the same normalize path as backfill.
 *
 * Returns 200 fast; Strava retries on non-2xx and disables slow endpoints.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getProvider } from '@/providers';
import { stravaEnv } from '@/providers/strava/env';
import { athleteIdForStravaOwner, fetchAndIngestActivityById } from '@/server/strava';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === stravaEnv().verifyToken && challenge) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }
  return NextResponse.json({ error: 'verification failed' }, { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const strava = getProvider('strava');

  if (!(await strava.verifyWebhook(req, rawBody))) {
    return NextResponse.json({ error: 'invalid' }, { status: 401 });
  }

  let inbound;
  try {
    inbound = strava.parseWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: 'malformed body' }, { status: 400 });
  }

  const db = await getDb();
  let handled = 0;
  for (const item of inbound) {
    const e = item.payload as { object_id?: number; aspect_type?: string };
    if (e.aspect_type === 'delete') continue; // we keep history; ignore deletes for now
    if (!item.providerUserId || e.object_id == null) continue;
    const athleteId = await athleteIdForStravaOwner(db, item.providerUserId);
    if (!athleteId) continue; // unmapped owner, nothing to attribute yet
    try {
      await fetchAndIngestActivityById(db, athleteId, e.object_id);
      handled++;
    } catch {
      /* swallow: respond 200 so Strava doesn't disable the endpoint */
    }
  }
  return NextResponse.json({ handled }, { status: 200 });
}
