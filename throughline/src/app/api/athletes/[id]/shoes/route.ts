/**
 * POST /api/athletes/[id]/shoes — manage a shoe.
 * Body: { action: 'add'|'default'|'retire'|'delete', ... }.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { addShoe, setDefaultShoe, retireShoe, deleteShoe } from '@/server/shoes';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: {
    action?: string;
    shoeId?: string;
    name?: string;
    brand?: string | null;
    startDate?: string | null;
    initialMiles?: number;
    maxMiles?: number;
    isDefault?: boolean;
    retiredAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    switch (body.action) {
      case 'add':
        await addShoe(db, id, {
          name: body.name ?? '',
          brand: body.brand ?? null,
          startDate: body.startDate ?? null,
          initialMiles: body.initialMiles,
          maxMiles: body.maxMiles,
          isDefault: body.isDefault,
        });
        break;
      case 'default':
        if (!body.shoeId) throw new Error('shoeId required.');
        await setDefaultShoe(db, id, body.shoeId);
        break;
      case 'retire':
        if (!body.shoeId) throw new Error('shoeId required.');
        await retireShoe(db, id, body.shoeId, body.retiredAt || new Date().toISOString().slice(0, 10));
        break;
      case 'delete':
        if (!body.shoeId) throw new Error('shoeId required.');
        await deleteShoe(db, id, body.shoeId);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 422 });
  }
}
