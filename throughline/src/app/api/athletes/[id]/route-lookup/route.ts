/**
 * POST /api/athletes/[id]/route-lookup — resolve a pasted Strava route link to
 * distance + elevation, using the athlete's own Strava token. We parse a numeric
 * route id from the link and build the Strava API URL ourselves (never fetch the
 * pasted URL), so there's no SSRF surface.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { guardAthleteWrite } from '@/server/apiAccess';
import { parseStravaRouteId } from '@/lib/stravaRoute';
import { fetchStravaRoute } from '@/server/strava';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const routeId = parseStravaRouteId(String(body.url ?? ''));
  if (!routeId) {
    return NextResponse.json({ error: 'Paste a Strava route link (strava.com/routes/…).' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const stats = await fetchStravaRoute(db, id, routeId);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Lookup failed.' }, { status: 422 });
  }
}
