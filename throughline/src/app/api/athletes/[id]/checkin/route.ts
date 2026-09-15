import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { checkInSchema, submitCheckIn } from '@/server/checkIn';
import { todayISO } from '@/server/console';
import { guardAthleteWrite } from '@/server/apiAccess';
import { getRecoveryInsights, persistReadiness } from '@/server/recovery';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  const parsed = checkInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid check-in.' }, { status: 400 });
  }
  if (parsed.data.day > todayISO()) return NextResponse.json({ error: 'Check-ins cannot be dated in the future.' }, { status: 400 });
  try {
    const db = await getDb();
    await submitCheckIn(db, id, parsed.data);
    // Recompute immediately, including for athletes without a wearable. The
    // monitor and coach see the same result as the refreshed athlete portal.
    const recovery = await getRecoveryInsights(db, id, parsed.data.day);
    if (recovery.readiness) await persistReadiness(db, id, recovery.readiness);
    return NextResponse.json({ ok: true, readiness: recovery.readiness });
  } catch {
    return NextResponse.json({ error: 'Could not finish saving your check-in. Please retry.' }, { status: 422 });
  }
}
