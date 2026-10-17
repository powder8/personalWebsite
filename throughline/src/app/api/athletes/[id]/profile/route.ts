/**
 * POST /api/athletes/[id]/profile — update editable athlete profile fields.
 * Only fields present in the body are changed.
 *   dateOfBirth: 'YYYY-MM-DD' | null  (masters pace defaults / age-grading)
 *   sex: 'female' | 'male' | 'other'  (gates cycle tracking)
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { guardAthleteWrite } from '@/server/apiAccess';
import { publicErrorMessage } from '@/lib/publicError';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEX = new Set(['female', 'male', 'other']);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: { dateOfBirth?: string | null; sex?: string; timezone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const set: { dateOfBirth?: string | null; sex?: string; timezone?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (body.timezone != null) {
    const tz = String(body.timezone);
    if (!isValidTimeZone(tz)) return NextResponse.json({ error: 'Unknown timezone.' }, { status: 400 });
    set.timezone = tz;
  }
  if ('dateOfBirth' in body) {
    const dob = body.dateOfBirth ? String(body.dateOfBirth) : null;
    if (dob != null && !DATE_RE.test(dob)) {
      return NextResponse.json({ error: 'dateOfBirth must be YYYY-MM-DD.' }, { status: 400 });
    }
    set.dateOfBirth = dob;
  }
  if (body.sex != null) {
    if (!SEX.has(body.sex)) return NextResponse.json({ error: 'Invalid sex value.' }, { status: 400 });
    set.sex = body.sex;
  }

  try {
    const db = await getDb();
    await db.update(athletes).set(set).where(eq(athletes.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: publicErrorMessage(e, 'Failed.') }, { status: 422 });
  }
}

/** A real IANA zone name ("America/New_York"), as Intl understands it. */
function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
