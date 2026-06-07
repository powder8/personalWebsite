/**
 * Garmin push webhook — the always-on endpoint Garmin requires.
 *
 * Contract (the whole point of the append-only design):
 *   1. Verify the request is authentic.
 *   2. Write EVERY inbound record to raw_events, verbatim (dedup by hash).
 *   3. Enqueue async normalization via Inngest.
 *   4. Return 200 fast. Never do normalization inline — Garmin has a tight
 *      ack budget and will retry/disable slow endpoints.
 *
 * This route does NOT mutate or interpret data; it only captures it.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { rawEvents, connectedAccounts } from '@/db/schema';
import { getProvider } from '@/providers';
import { inngest, events } from '@/inngest/client';
import { payloadHash } from '@/lib/hash';

// Webhooks need the Node.js runtime (crypto + DB driver), not edge.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const db = await getDb();
  const garmin = getProvider('garmin');

  const ok = await garmin.verifyWebhook(req, rawBody);
  if (!ok) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let inbound;
  try {
    inbound = garmin.parseWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: 'malformed body' }, { status: 400 });
  }

  let accepted = 0;
  for (const item of inbound) {
    const hash = payloadHash(JSON.stringify(item.payload));

    // Map provider user -> athlete (best effort; raw_events tolerates a null
    // athleteId so we never drop a payload we can't yet attribute).
    let athleteId: string | null = null;
    if (item.providerUserId) {
      const [acct] = await db
        .select({ athleteId: connectedAccounts.athleteId })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.provider, 'garmin'),
            eq(connectedAccounts.providerUserId, item.providerUserId),
          ),
        )
        .limit(1);
      athleteId = acct?.athleteId ?? null;
    }

    // Append-only insert; dedup on (provider, eventType, payloadHash).
    const [inserted] = await db
      .insert(rawEvents)
      .values({
        athleteId,
        provider: 'garmin',
        source: 'webhook',
        eventType: item.eventType,
        providerUserId: item.providerUserId ?? null,
        payload: item.payload as object,
        payloadHash: hash,
      })
      .onConflictDoNothing({
        target: [rawEvents.provider, rawEvents.eventType, rawEvents.payloadHash],
      })
      .returning({ id: rawEvents.id });

    if (inserted) {
      accepted++;
      await inngest.send({
        name: events.rawEventReceived,
        data: { rawEventId: inserted.id },
      });
    }
  }

  return NextResponse.json({ received: inbound.length, accepted }, { status: 200 });
}
