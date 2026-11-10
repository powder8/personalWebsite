import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { athleteToday } from '@/server/athleteToday';
import { checkInSchema, submitCheckIn } from '@/server/checkIn';
import { guardAthleteWrite } from '@/server/apiAccess';
import { refreshAthleteHealth } from '@/server/healthRefresh';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  const parsed = checkInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid check-in.' }, { status: 400 });
  }
  if (parsed.data.day > (await athleteToday(id))) return NextResponse.json({ error: 'Check-ins cannot be dated in the future.' }, { status: 400 });
  try {
    const db = await getDb();
    await submitCheckIn(db, id, parsed.data);
    // Recompute immediately, including for athletes without a wearable: body
    // status, the plan's adjustments, and the day's readiness all see the answer.
    const health = await refreshAthleteHealth(db, id, parsed.data.day);
    return NextResponse.json({ ok: true, readiness: health.recovery.readiness });
  } catch {
    return NextResponse.json({ error: 'Could not finish saving your check-in. Please retry.' }, { status: 422 });
  }
}
