/**
 * Begin the Garmin OAuth connect flow: redirect the athlete to Garmin's
 * authorization page. `state` should be a signed/opaque token tying the
 * callback back to the athlete + a CSRF nonce (wired up when the athlete
 * onboarding flow exists).
 */
import { NextResponse } from 'next/server';
import { getProvider } from '@/providers';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const athleteId = url.searchParams.get('athleteId');
  if (!athleteId) {
    return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  }
  // TODO: replace with a signed state (athleteId + nonce) and store the nonce.
  const state = athleteId;
  const authUrl = getProvider('garmin').getAuthorizationUrl(state);
  return NextResponse.redirect(authUrl);
}
