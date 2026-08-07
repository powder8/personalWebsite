/**
 * Whoop webhook handler (API/webhook version V2).
 * URL registered in the Whoop developer portal:
 *   https://throughline.badoo.net/api/whoop/webhooks
 *
 * Event types (v2):
 *   recovery.updated / recovery.deleted
 *   sleep.updated    / sleep.deleted
 * The `id` field is a UUID (v2). We don't need it — on any recovery/sleep event
 * we re-pull the last few days for that user, which is idempotent.
 *
 * Signature verification (v2): WHOOP sends two headers —
 *   X-WHOOP-Signature            = base64(HMAC-SHA256(timestamp + rawBody, clientSecret))
 *   X-WHOOP-Signature-Timestamp  = milliseconds since epoch
 * The HMAC key is the app's CLIENT SECRET (not a separate webhook secret).
 */
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from '@/db';
import { whoopEnv } from '@/providers/whoop/env';
import { athleteIdForWhoopUser, syncWhoopData } from '@/server/whoop';

export const runtime = 'nodejs';

// Reject events whose timestamp is older than this (replay protection).
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

interface WhoopWebhookEvent {
  type: string; // 'recovery.updated' | 'sleep.updated' | ...
  trace_id: string;
  user_id: number;
  id: string; // UUID of the object that triggered the event (v2)
}

function verifySignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  clientSecret: string,
): boolean {
  // Fail CLOSED: with no secret we cannot authenticate the caller, so reject
  // rather than process forged events. (A misconfigured prod deploy will see
  // WHOOP retries 401 — visible — instead of silently accepting spoofed data.)
  if (!clientSecret) return false;
  if (!timestamp || !signature) return false;

  // Replay protection: timestamp must be recent and numeric.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SIGNATURE_AGE_MS) return false;

  const expected = createHmac('sha256', clientSecret)
    .update(timestamp + rawBody)
    .digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const { clientSecret } = whoopEnv();
  const signature = req.headers.get('x-whoop-signature');
  const timestamp = req.headers.get('x-whoop-signature-timestamp');

  if (!verifySignature(rawBody, timestamp, signature, clientSecret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let event: WhoopWebhookEvent;
  try {
    event = JSON.parse(rawBody) as WhoopWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { type, user_id } = event;
  // We only act on data that lands in our tables; delete events and other
  // types are acknowledged without a re-pull.
  if (type !== 'recovery.updated' && type !== 'sleep.updated') {
    return NextResponse.json({ ok: true, skipped: type });
  }

  try {
    const db = await getDb();
    const athleteId = await athleteIdForWhoopUser(db, String(user_id));
    if (!athleteId) {
      // Not a registered athlete — acknowledge so Whoop doesn't retry.
      return NextResponse.json({ ok: true, skipped: 'unknown_user' });
    }
    // Re-pull the last 3 days to capture the freshly-computed record.
    await syncWhoopData(db, athleteId, 3);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed.';
    console.error('[whoop-webhook]', msg);
    // Acknowledge receipt even on error so WHOOP doesn't hammer retries against
    // a transient failure; the next event (or manual sync) will reconcile.
    return NextResponse.json({ ok: false, error: msg });
  }
}
