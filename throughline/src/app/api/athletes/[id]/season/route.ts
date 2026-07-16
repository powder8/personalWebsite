/**
 * POST /api/athletes/[id]/season — set up an athlete's season (goal + key races
 * + fitness anchor + volume) and generate the race-aware plan.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { setupSeason, type SeasonSetupInput } from '@/server/season';
import { todayISO } from '@/server/console';
import { guardAthleteWrite } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: Partial<SeasonSetupInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.goalRace?.name || !body.goalRace?.date) {
    return NextResponse.json({ error: 'A goal race with a name and date is required.' }, { status: 400 });
  }
  if (!body.fitness?.race && body.fitness?.thresholdSecPerKm == null) {
    return NextResponse.json(
      { error: 'A fitness anchor is required (a recent race or a threshold pace).' },
      { status: 400 },
    );
  }

  const input: SeasonSetupInput = {
    startDay: body.startDay ?? todayISO(),
    goalRace: { ...body.goalRace, priority: 'goal' },
    keyRaces: body.keyRaces ?? [],
    fitness: body.fitness,
    startVolumeMiles: Number(body.startVolumeMiles ?? 30),
    peakVolumeMiles: Number(body.peakVolumeMiles ?? 50),
  };

  try {
    const db = await getDb();
    const result = await setupSeason(db, id, input);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Season setup failed.';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
