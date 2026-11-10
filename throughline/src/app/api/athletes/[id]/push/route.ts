/**
 * Web Push subscriptions for one athlete.
 *   POST   { subscription }  → remember this browser / installed app
 *   DELETE { endpoint }      → forget it
 *   PUT                      → send a test notification to every device
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { guardAthleteWrite } from '@/server/apiAccess';
import { isValidSubscription, pushConfigured, removeSubscription, saveSubscription, sendPushToAthlete } from '@/server/push';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  if (!pushConfigured()) return NextResponse.json({ error: 'Notifications are not set up on the server yet.' }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { subscription?: unknown } | null;
  if (!isValidSubscription(body?.subscription)) return NextResponse.json({ error: 'Invalid subscription.' }, { status: 400 });
  const db = await getDb();
  await saveSubscription(db, id, body!.subscription, req.headers.get('user-agent'));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== 'string') return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await removeSubscription(await getDb(), body.endpoint);
  return NextResponse.json({ ok: true });
}

export async function PUT(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  const delivered = await sendPushToAthlete(await getDb(), id, {
    title: 'Notifications are on',
    body: 'Throughline will tell you here when your body status changes or your plan adjusts.',
    url: `/me/${id}`,
    tag: 'test',
  });
  return NextResponse.json({ ok: true, delivered });
}
