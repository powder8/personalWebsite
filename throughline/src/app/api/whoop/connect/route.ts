/**
 * Begin the Whoop OAuth connect flow: redirect the athlete to Whoop's
 * authorization page. `state` carries the athleteId so the callback can attach
 * the tokens to the right athlete.
 *
 * Colocated with the callback under /api/whoop/* so the paths mirror the app's
 * registered redirect URL (https://throughline.badoo.net/api/whoop/callback).
 */
import { NextResponse } from 'next/server';
import { whoopConfigured } from '@/providers/whoop/env';
import { getAuthorizationUrl } from '@/providers/whoop';
import { guardAthleteWrite } from '@/server/apiAccess';
import { issueOAuthState } from '@/server/oauthState';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const athleteId = url.searchParams.get('athleteId');
  if (!athleteId) {
    return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  }
  if (!whoopConfigured()) {
    return NextResponse.json(
      { error: 'Whoop is not configured. Set WHOOP_CLIENT_ID / SECRET / REDIRECT_URI.' },
      { status: 503 },
    );
  }
  // Only the athlete themselves (or an admin / assigned coach) may start a
  // connect for this athlete — the flow is under a public prefix, so nothing
  // upstream checks this.
  const denied = await guardAthleteWrite(athleteId);
  if (denied) return denied;

  // Bind a signed, single-use state nonce to this athlete in an httpOnly cookie;
  // the callback trusts the cookie, not the returned `state` param (CSRF).
  const { state, cookie } = issueOAuthState('whoop', athleteId);
  const res = NextResponse.redirect(getAuthorizationUrl(state));
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
