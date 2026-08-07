/**
 * Begin the Strava OAuth connect flow: redirect the athlete to Strava's
 * authorization page. `state` is a signed single-use nonce bound to the athlete
 * in an httpOnly cookie; the callback trusts the cookie, not the query (CSRF).
 */
import { NextResponse } from 'next/server';
import { getProvider } from '@/providers';
import { stravaConfigured } from '@/providers/strava/env';
import { guardAthleteWrite } from '@/server/apiAccess';
import { issueOAuthState } from '@/server/oauthState';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const athleteId = url.searchParams.get('athleteId');
  if (!athleteId) {
    return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  }
  if (!stravaConfigured()) {
    return NextResponse.json(
      { error: 'Strava is not configured. Set STRAVA_CLIENT_ID / SECRET / REDIRECT_URI.' },
      { status: 503 },
    );
  }
  // Only the athlete themselves (or an admin / assigned coach) may start this.
  const denied = await guardAthleteWrite(athleteId);
  if (denied) return denied;

  const { state, cookie } = issueOAuthState('strava', athleteId);
  const res = NextResponse.redirect(getProvider('strava').getAuthorizationUrl(state));
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
