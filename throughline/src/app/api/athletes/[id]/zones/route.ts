/**
 * POST /api/athletes/[id]/zones — adjust an athlete's pace zones.
 * Body: { deltas: { [zoneKey]: secPerMile } }  (positive = slower)
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { adjustAthleteZones } from '@/server/paceAdjust';
import { todayISO } from '@/server/console';
import type { ZoneKey } from '@/engine/plan';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { deltas?: Record<string, number> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const deltas: Partial<Record<ZoneKey, number>> = {};
  for (const [k, v] of Object.entries(body.deltas ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) deltas[k as ZoneKey] = n;
  }
  if (Object.keys(deltas).length === 0) {
    return NextResponse.json({ error: 'No non-zero adjustments provided.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const result = await adjustAthleteZones(db, id, deltas, { today: todayISO() });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
