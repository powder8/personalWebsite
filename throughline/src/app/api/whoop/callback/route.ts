/**
 * Whoop OAuth callback: exchange the code for tokens, store them, kick off an
 * initial sync, and redirect back to the athlete's settings page.
 *
 * This path MUST match the redirect URL registered on the WHOOP app:
 *   https://throughline.badoo.net/api/whoop/callback
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { exchangeCode } from '@/providers/whoop';
import { saveWhoopTokens, syncWhoopData } from '@/server/whoop';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const athleteId = url.searchParams.get('state'); // we set state = athleteId
  const base = url.origin;

  if (error) {
    return NextResponse.redirect(`${base}/me/${athleteId ?? ''}/settings?whoop=denied`);
  }
  if (!code || !athleteId) {
    return NextResponse.json({ error: 'Missing code or state.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const tokens = await exchangeCode(code);
    await saveWhoopTokens(db, athleteId, tokens);
    // Kick off an initial 30-day backfill to populate HRV/sleep history.
    await syncWhoopData(db, athleteId, 30).catch(() => {
      // Non-fatal — the data will sync on the next webhook event.
    });
    return NextResponse.redirect(`${base}/me/${athleteId}/settings?whoop=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Whoop connection failed.';
    return NextResponse.redirect(
      `${base}/me/${athleteId}/settings?whoop=error&msg=${encodeURIComponent(msg)}`,
    );
  }
}
