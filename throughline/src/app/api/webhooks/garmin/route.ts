/**
 * Garmin notification webhook (Health + Activity APIs), PING or PUSH mode.
 *
 *   1. Authenticate: the registered URL carries ?key=<GARMIN_WEBHOOK_SECRET>
 *      (Garmin doesn't sign requests). Fails closed.
 *   2. Acknowledge fast: Garmin retries and eventually disables slow endpoints,
 *      so all fetching and normalizing happens after the response.
 *   3. PING records ({ userId, callbackURL }) are fetched from Garmin with that
 *      user's token; PUSH records are the summaries themselves. Either way each
 *      summary is stored verbatim in raw_events, then normalized and persisted.
 *   4. `deregistrations` (the user removed us in Garmin Connect) revoke the
 *      account; `userPermissionsChange` updates what we may read.
 */
import { NextResponse, after } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import type { DB } from '@/db';
import { connectedAccounts, rawEvents } from '@/db/schema';
import { getProvider } from '@/providers';
import { persistNormalizedBatch } from '@/server/ingest';
import { payloadHash } from '@/lib/hash';
import { fetchGarminCallback, getGarminAccountByUserId, type GarminAccount } from '@/server/garmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const rawBody = await req.text();
  const garmin = getProvider('garmin');
  if (!(await garmin.verifyWebhook(req, rawBody))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let inbound;
  try {
    inbound = garmin.parseWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: 'malformed body' }, { status: 400 });
  }

  after(async () => {
    const db = await getDb();
    for (const item of inbound) {
      try {
        if (!item.providerUserId) continue;
        const acct = await getGarminAccountByUserId(db, item.providerUserId);
        if (!acct) continue; // not (or no longer) connected: nothing to attribute
        const p = item.payload as Record<string, unknown>;

        if (item.eventType === 'deregistrations') {
          await db
            .update(connectedAccounts)
            .set({ status: 'revoked', accessToken: null, refreshToken: null, updatedAt: new Date() })
            .where(eq(connectedAccounts.id, acct.id));
          continue;
        }
        if (item.eventType === 'userPermissionsChange') {
          const perms = Array.isArray(p.permissions) ? (p.permissions as string[]) : null;
          await db.update(connectedAccounts).set({ scopes: perms, updatedAt: new Date() }).where(eq(connectedAccounts.id, acct.id));
          continue;
        }

        const summaries = typeof p.callbackURL === 'string' ? await fetchGarminCallback(db, acct, p.callbackURL) : [p];
        for (const s of summaries) await ingestSummary(db, acct, item.eventType, s);
      } catch (e) {
        console.error('[garmin-webhook]', item.eventType, e instanceof Error ? e.message : e);
      }
    }
  });

  return NextResponse.json({ received: inbound.length }, { status: 200 });
}

/** Store one summary verbatim (dedup by hash), then normalize and persist it. */
async function ingestSummary(db: DB, acct: GarminAccount, eventType: string, summary: unknown) {
  const [inserted] = await db
    .insert(rawEvents)
    .values({
      athleteId: acct.athleteId,
      provider: 'garmin',
      source: 'webhook',
      eventType,
      providerUserId: acct.providerUserId,
      payload: summary as object,
      payloadHash: payloadHash(JSON.stringify(summary)),
    })
    .onConflictDoNothing({ target: [rawEvents.provider, rawEvents.eventType, rawEvents.payloadHash] })
    .returning({ id: rawEvents.id });
  if (!inserted) return; // already have it
  const batch = getProvider('garmin').normalize(eventType, summary);
  await persistNormalizedBatch(db, acct.athleteId, inserted.id, batch, 'garmin');
  await db.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, inserted.id));
}
