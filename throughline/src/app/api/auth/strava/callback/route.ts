/**
 * Strava OAuth callback: exchange the code for tokens, store them, and kick off
 * an initial backfill so the athlete's recent training shows up immediately.
 * Redirects back to the athlete portal.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/db';
import { getProvider } from '@/providers';
import { saveStravaTokens } from '@/server/strava';
import { verifyOAuthState, oauthCookieName } from '@/server/oauthState';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const base = url.origin;

  // Trust the athleteId bound in our signed connect-time cookie, never the
  // returned `state` param — that's what makes this CSRF-safe.
  const cookieName = oauthCookieName('strava');
  const store = await cookies();
  const athleteId = verifyOAuthState(url.searchParams.get('state'), store.get(cookieName)?.value);
  const clear = (res: NextResponse) => {
    res.cookies.set(cookieName, '', { path: '/', maxAge: 0 });
    return res;
  };

  if (error) {
    return clear(NextResponse.redirect(`${base}/me/${athleteId ?? ''}?strava=denied`));
  }
  if (!athleteId) {
    return NextResponse.json(
      { error: 'Invalid or expired connect request. Please start the Strava connection again.' },
      { status: 400 },
    );
  }
  if (!code) {
    return NextResponse.json({ error: 'Missing code.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const tokens = await getProvider('strava').exchangeCode(code);
    await saveStravaTokens(db, athleteId, tokens);
    // No synchronous backfill here — a large history would exceed the request
    // time limit. The portal kicks off a chunked, resumable import instead.
    return clear(NextResponse.redirect(`${base}/me/${athleteId}?strava=connected&import=1`));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Strava connection failed.';
    return clear(NextResponse.redirect(`${base}/me/${athleteId}?strava=error&msg=${encodeURIComponent(msg)}`));
  }
}
