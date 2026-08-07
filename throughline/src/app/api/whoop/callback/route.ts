/**
 * Whoop OAuth callback: exchange the code for tokens, store them, kick off an
 * initial sync, and redirect back to the athlete's settings page.
 *
 * This path MUST match the redirect URL registered on the WHOOP app:
 *   https://throughline.badoo.net/api/whoop/callback
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/db';
import { exchangeCode } from '@/providers/whoop';
import { saveWhoopTokens, syncWhoopData } from '@/server/whoop';
import { verifyOAuthState, oauthCookieName } from '@/server/oauthState';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const base = url.origin;

  // Trust the athleteId bound in our signed connect-time cookie, never the
  // returned `state` param — that's what makes this CSRF-safe.
  const cookieName = oauthCookieName('whoop');
  const store = await cookies();
  const athleteId = verifyOAuthState(url.searchParams.get('state'), store.get(cookieName)?.value);
  const clear = (res: NextResponse) => {
    res.cookies.set(cookieName, '', { path: '/', maxAge: 0 });
    return res;
  };

  if (error) {
    return clear(NextResponse.redirect(`${base}/me/${athleteId ?? ''}/settings?whoop=denied`));
  }
  if (!athleteId) {
    return NextResponse.json(
      { error: 'Invalid or expired connect request. Please start the Whoop connection again.' },
      { status: 400 },
    );
  }
  if (!code) {
    return NextResponse.json({ error: 'Missing code.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const tokens = await exchangeCode(code);
    await saveWhoopTokens(db, athleteId, tokens);
    // Kick off an initial 30-day backfill to populate HRV/sleep history.
    await syncWhoopData(db, athleteId, 30).catch(() => {
      // Non-fatal — the data will sync on the next webhook event.
    });
    return clear(NextResponse.redirect(`${base}/me/${athleteId}/settings?whoop=connected`));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Whoop connection failed.';
    return clear(
      NextResponse.redirect(`${base}/me/${athleteId}/settings?whoop=error&msg=${encodeURIComponent(msg)}`),
    );
  }
}
