/**
 * Begin the Whoop OAuth connect flow: redirect the athlete to Whoop's
 * authorization page. `state` carries the athleteId so the callback can attach
 * the tokens to the right athlete.
 */
import { NextResponse } from 'next/server';
import { whoopConfigured } from '@/providers/whoop/env';
import { getAuthorizationUrl } from '@/providers/whoop';

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
  return NextResponse.redirect(getAuthorizationUrl(athleteId));
}
