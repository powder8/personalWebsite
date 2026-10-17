/**
 * Begin the Garmin OAuth 2.0 PKCE flow. `state` is a signed single-use nonce
 * bound to the athlete in an httpOnly cookie (the callback trusts the cookie,
 * not the query: CSRF-safe), and the PKCE verifier is derived from that state.
 */
import { NextResponse } from 'next/server';
import { getProvider } from '@/providers';
import { garminConfigured } from '@/providers/garmin/env';
import { guardAthleteWrite } from '@/server/apiAccess';
import { issueOAuthState } from '@/server/oauthState';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const athleteId = new URL(req.url).searchParams.get('athleteId');
  if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  if (!garminConfigured()) return NextResponse.json({ error: 'Garmin is not configured yet.' }, { status: 503 });
  const denied = await guardAthleteWrite(athleteId);
  if (denied) return denied;

  const { state, cookie } = issueOAuthState('garmin', athleteId);
  const res = NextResponse.redirect(getProvider('garmin').getAuthorizationUrl(state));
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
