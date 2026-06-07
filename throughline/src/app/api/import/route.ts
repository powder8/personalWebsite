/**
 * POST /api/import — import a coach training log from a Google Sheets link.
 * Body: { url, name, email, year }. Returns the import summary.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { importFromSheetUrl } from '@/server/sheetImport';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { url?: string; name?: string; email?: string; year?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const url = (body.url ?? '').trim();
  const name = (body.name ?? '').trim();
  const email = (body.email ?? '').trim();
  const year = parseInt(String(body.year ?? ''), 10);

  if (!url || !name || !email || !Number.isFinite(year)) {
    return NextResponse.json({ error: 'url, name, email, and year are all required.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await importFromSheetUrl(db, { url, name, email, year });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Import failed.';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
