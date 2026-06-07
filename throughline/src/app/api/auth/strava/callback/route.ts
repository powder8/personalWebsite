/**
 * Strava OAuth callback: exchange the code for tokens, store them, and kick off
 * an initial backfill so the athlete's recent training shows up immediately.
 * Redirects back to the athlete portal.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getProvider } from '@/providers';
import { saveStravaTokens, syncStravaActivities } from '@/server/strava';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const athleteId = url.searchParams.get('state'); // we set state = athleteId
  const base = url.origin;

  if (error) {
    return NextResponse.redirect(`${base}/me/${athleteId ?? ''}?strava=denied`);
  }
  if (!code || !athleteId) {
    return NextResponse.json({ error: 'Missing code or state.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const tokens = await getProvider('strava').exchangeCode(code);
    await saveStravaTokens(db, athleteId, tokens);
    // Initial backfill (a year). Best-effort: connection still succeeds if the
    // pull hits a transient error — the athlete can re-sync.
    try {
      await syncStravaActivities(db, athleteId, { fallbackDays: 365 });
    } catch {
      /* non-fatal */
    }
    return NextResponse.redirect(`${base}/me/${athleteId}?strava=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Strava connection failed.';
    return NextResponse.redirect(`${base}/me/${athleteId}?strava=error&msg=${encodeURIComponent(msg)}`);
  }
}
