/**
 * Garmin OAuth callback: verify the signed state, exchange the code (with the
 * PKCE verifier re-derived from that state), resolve the stable Garmin user
 * id, store encrypted tokens, and request history backfill. Garmin delivers
 * the backfill later through the webhook.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/db';
import { getProvider } from '@/providers';
import { pkceVerifier } from '@/providers/garmin';
import { oauthCookieName, verifyOAuthState } from '@/server/oauthState';
import { fetchGarminUserId, requestGarminBackfill, saveGarminTokens } from '@/server/garmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BACKFILL_DAYS = 365;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieName = oauthCookieName('garmin');
  const store = await cookies();
  const athleteId = verifyOAuthState(state, store.get(cookieName)?.value);
  const done = (to: string) => {
    const res = NextResponse.redirect(`${base}${to}`);
    res.cookies.set(cookieName, '', { path: '/', maxAge: 0 });
    return res;
  };

  if (!athleteId || !state) return done('/me?garmin=error');
  if (!code) return done(`/me/${athleteId}/settings?garmin=denied`);

  try {
    const secret = process.env.AUTH_SECRET || 'throughline-dev-oauth-secret';
    const tokens = await getProvider('garmin').exchangeCode(code, { codeVerifier: pkceVerifier(state, secret) });
    tokens.providerUserId = await fetchGarminUserId(tokens.accessToken);
    const db = await getDb();
    await saveGarminTokens(db, athleteId, tokens);
    // Best-effort: the connection stands even if the backfill request fails.
    await requestGarminBackfill(db, athleteId, BACKFILL_DAYS).catch(() => undefined);
    return done(`/me/${athleteId}/settings?garmin=connected`);
  } catch (e) {
    console.error('[garmin-callback]', e instanceof Error ? e.message : e);
    return done(`/me/${athleteId}/settings?garmin=error`);
  }
}
