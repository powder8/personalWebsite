/**
 * Whoop webhook handler.
 * URL registered in the Whoop developer portal:
 *   https://throughline.badoo.net/api/whoop/webhooks
 *
 * Whoop sends a POST for each event and optionally a GET to verify the
 * endpoint is reachable (Whoop uses a direct POST test, not a hub.challenge
 * handshake like Strava — the GET just needs to return 200).
 *
 * Event types we care about:
 *   recovery.updated — new recovery score available (HRV, RHR, score)
 *   sleep.updated    — sleep record finalised
 *
 * Signature verification: Whoop signs the body with HMAC-SHA256 using the
 * webhook client secret and sends it in the X-WHOOP-Signature-256 header as
 * "sha256=<hex>". Verification is skipped when WHOOP_WEBHOOK_SECRET is unset.
 */
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from '@/db';
import { whoopEnv } from '@/providers/whoop/env';
import { athleteIdForWhoopUser, syncWhoopData } from '@/server/whoop';

export const runtime = 'nodejs';

interface WhoopWebhookEvent {
  type: string; // e.g. 'recovery.updated', 'sleep.updated'
  trace_id: string;
  user_id: number;
  payload: { id: number };
}

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return true; // no secret = no verification
  const [scheme, hexSig] = header.split('=', 2);
  if (scheme !== 'sha256' || !hexSig) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(hexSig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const { webhookSecret } = whoopEnv();
  const sig = req.headers.get('x-whoop-signature-256');

  if (!verifySignature(rawBody, sig, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let event: WhoopWebhookEvent;
  try {
    event = JSON.parse(rawBody) as WhoopWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { type, user_id } = event;
  if (type !== 'recovery.updated' && type !== 'sleep.updated') {
    // Acknowledge unsupported events immediately.
    return NextResponse.json({ ok: true, skipped: type });
  }

  try {
    const db = await getDb();
    const athleteId = await athleteIdForWhoopUser(db, String(user_id));
    if (!athleteId) {
      // Not a registered athlete — acknowledge so Whoop doesn't retry.
      return NextResponse.json({ ok: true, skipped: 'unknown_user' });
    }
    // Pull the last 3 days so we capture the freshly-computed record.
    await syncWhoopData(db, athleteId, 3);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed.';
    console.error('[whoop-webhook]', msg);
    // Return 200 to acknowledge receipt even on error — Whoop will retry on
    // non-2xx, and a permanent server error would cause repeated retries.
    return NextResponse.json({ ok: false, error: msg });
  }
}
