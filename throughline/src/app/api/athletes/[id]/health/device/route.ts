/**
 * POST /api/athletes/[id]/health/device — the native app pushes HealthKit
 * (iOS) or Health Connect (Android) data here. Session-authenticated: the app's
 * web view carries the athlete's ordinary cookie, so there is no separate
 * device token to provision or rotate. Idempotent per payload; rate-limited
 * per athlete. Body shape: see DevicePayload in server/deviceHealthLogic.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { guardAthleteWrite } from '@/server/apiAccess';
import { ingestDeviceHealth } from '@/server/deviceHealth';
import { todayISO } from '@/server/console';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const db = await getDb();
  const result = await ingestDeviceHealth(db, id, body, todayISO());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
