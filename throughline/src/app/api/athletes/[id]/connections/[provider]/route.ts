/**
 * DELETE /api/athletes/[id]/connections/[provider] — disconnect Strava, Whoop,
 * or Garmin: revoke our access at the provider, then forget the tokens. Synced
 * history stays (delete the account to remove it).
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { guardAthleteWrite } from '@/server/apiAccess';
import { DISCONNECTABLE, disconnectProvider, type DisconnectableProvider } from '@/server/accountDeletion';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; provider: string }> }) {
  const { id, provider } = await ctx.params;
  if (!(DISCONNECTABLE as string[]).includes(provider)) {
    return NextResponse.json({ error: 'Unknown connection.' }, { status: 404 });
  }
  const denied = await guardAthleteWrite(id);
  if (denied) return denied;
  const db = await getDb();
  const { revoked } = await disconnectProvider(db, id, provider as DisconnectableProvider);
  return NextResponse.json({ ok: true, revoked });
}
