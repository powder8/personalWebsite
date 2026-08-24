/**
 * POST /api/athletes/[id]/units — set the athlete's distance/pace unit.
 * Body: { units: 'mi' | 'km' }.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { units?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const units = body.units === 'km' ? 'km' : body.units === 'mi' ? 'mi' : null;
  if (!units) return NextResponse.json({ error: "units must be 'mi' or 'km'." }, { status: 400 });

  const db = await getDb();
  await db.update(athletes).set({ units, updatedAt: new Date() }).where(eq(athletes.id, id));
  return NextResponse.json({ ok: true, units });
}
