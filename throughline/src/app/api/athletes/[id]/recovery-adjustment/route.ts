import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { guardAthleteWrite } from '@/server/apiAccess';
import { recoveryAdjustmentSchema, setRecoveryAdjustment } from '@/server/recoveryAdjustment';
import { todayISO } from '@/server/console';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  const parsed = recoveryAdjustmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a valid recovery adjustment.' }, { status: 400 });
  // New windows start today. Clearing an earlier window only addresses this
  // athlete's own deterministic row; it cannot remove a coach/injury directive.
  if (parsed.data.mode !== 'clear' && parsed.data.day !== todayISO()) {
    return NextResponse.json({ error: 'The day has changed. Refresh and try again.' }, { status: 400 });
  }
  await setRecoveryAdjustment(await getDb(), id, parsed.data);
  return NextResponse.json({ ok: true });
}
