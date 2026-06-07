/**
 * Begin the Strava OAuth connect flow: redirect the athlete to Strava's
 * authorization page. `state` carries the athleteId so the callback can attach
 * the tokens to the right athlete. (TODO: sign state with a CSRF nonce.)
 */
import { NextResponse } from 'next/server';
import { getProvider } from '@/providers';
import { stravaConfigured } from '@/providers/strava/env';

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
  const authUrl = getProvider('strava').getAuthorizationUrl(athleteId);
  return NextResponse.redirect(authUrl);
}
