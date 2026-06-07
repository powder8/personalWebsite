/**
 * GET /api/athletes/[id]/calendar.ics — subscribable iCal feed of the athlete's
 * published plan. Designed for calendar subscription (webcal://), so it returns
 * text/calendar and is safe to poll on the client's refresh interval.
 */
import { getDb } from '@/db';
import { buildPlanIcs } from '@/server/calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await getDb();
  const ics = await buildPlanIcs(db, id);
  if (ics == null) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="throughline.ics"',
      'cache-control': 'public, max-age=3600',
    },
  });
}
