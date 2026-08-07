/**
 * POST /api/import — import coach training logs from Google Sheets link(s).
 * Body: { name, email, files: [{ url, year }] }  (multiple links, one athlete)
 *   or legacy single: { url, name, email, year }
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { importMultipleSheets } from '@/server/sheetImport';
import { guardConsole } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = await guardConsole({ adminOnly: true });
  if (denied) return denied;

  let body: {
    url?: string;
    name?: string;
    email?: string;
    year?: number | string;
    files?: { url?: string; year?: number | string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  const email = (body.email ?? '').trim();
  // Accept a files[] array, or wrap a legacy single {url, year}.
  const rawFiles = body.files ?? (body.url ? [{ url: body.url, year: body.year }] : []);
  const files = rawFiles
    .map((f) => ({ url: (f.url ?? '').trim(), year: parseInt(String(f.year ?? ''), 10) }))
    .filter((f) => f.url && Number.isFinite(f.year));

  if (!name || !email) {
    return NextResponse.json({ error: 'Athlete name and email are required.' }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json({ error: 'Provide at least one sheet link with a year.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await importMultipleSheets(db, { name, email, files });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed.' }, { status: 422 });
  }
}
