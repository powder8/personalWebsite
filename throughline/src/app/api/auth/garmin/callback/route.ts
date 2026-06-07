/**
 * Garmin OAuth callback: exchange the code for tokens, persist them on the
 * athlete's ConnectedAccount, then trigger historical backfill so baselines and
 * load state are warm from day one.
 *
 * STATUS: scaffold — token exchange + backfill throw until Garmin Developer
 * access is granted (see README Phase 0.5). The persistence shape is final.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { connectedAccounts } from '@/db/schema';
import { getProvider } from '@/providers';

export const runtime = 'nodejs';

const BACKFILL_DAYS = 365; // target as much history as the program allows

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // currently == athleteId; see connect route TODO
  if (!code || !state) {
    return NextResponse.json({ error: 'code and state required' }, { status: 400 });
  }
  const athleteId = state;
  const garmin = getProvider('garmin');
  const db = await getDb();

  const tokens = await garmin.exchangeCode(code);

  await db
    .insert(connectedAccounts)
    .values({
      athleteId,
      provider: 'garmin',
      providerUserId: tokens.providerUserId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      tokenExpiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes ?? null,
      status: 'active',
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [connectedAccounts.provider, connectedAccounts.providerUserId],
      set: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        tokenExpiresAt: tokens.expiresAt ?? null,
        status: 'active',
        updatedAt: new Date(),
      },
    });

  // Warm the baselines: pull history now so day-one readiness has context.
  await garmin.requestBackfill(tokens, BACKFILL_DAYS);

  // Redirect back into the console (route TBD).
  return NextResponse.redirect(new URL(`/athletes/${athleteId}`, req.url));
}
