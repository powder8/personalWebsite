/**
 * POST /api/import/files — import one or more uploaded training-log files for an
 * athlete (multipart/form-data: name, email, year, files[]).
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { importUploadedFiles, type UploadedFile } from '@/server/sheetImport';
import { guardConsole } from '@/server/apiAccess';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = await guardConsole({ adminOnly: true });
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 });
  }
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const year = parseInt(String(form.get('year') ?? ''), 10) || new Date().getUTCFullYear();
  const fileEntries = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

  if (!name || !email) {
    return NextResponse.json({ error: 'Athlete name and email are required.' }, { status: 400 });
  }
  if (fileEntries.length === 0) {
    return NextResponse.json({ error: 'Attach at least one .xlsx file.' }, { status: 400 });
  }

  try {
    const files: UploadedFile[] = await Promise.all(
      fileEntries.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()), year })),
    );
    const db = await getDb();
    const result = await importUploadedFiles(db, { name, email, files });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed.' }, { status: 422 });
  }
}
