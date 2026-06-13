/**
 * Import a coach training log directly from a Google Sheets share link.
 *
 * The sheet must be shared "anyone with the link can view". We hit Google's
 * xlsx export endpoint, then reuse the same parser + persistence as the CLI.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes } from '@/db/schema';
import { parseTrainingLogBuffer } from '@/providers/manual/parseTrainingLog';
import { importParsedDays, type ImportResult } from '@/db/import';

/**
 * After an import lands, ground the fitness anchor in the newly-imported runs
 * (best demonstrated effort) — UNLESS a coach set it manually. This is what
 * makes imported training logs drive realistic paces, the same way a Strava
 * sync does. Never throws into the import path.
 *
 * The anchor/console modules are `server-only`; importing them dynamically here
 * keeps this module's pure helpers (parseSheetId, …) loadable under tsx tests.
 */
async function groundAnchorAfterImport(db: DB, athleteId: string): Promise<void> {
  try {
    const [{ ensureAutoAnchor }, { todayISO }] = await Promise.all([
      import('@/server/anchor'),
      import('@/server/console'),
    ]);
    await ensureAutoAnchor(db, athleteId, { today: todayISO() });
  } catch {
    // Non-fatal: a missing anchor just means paces stay provisional + flagged.
  }
}

export function parseSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

export function exportUrlFor(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}

export async function fetchSheetBuffer(url: string): Promise<Buffer> {
  const id = parseSheetId(url);
  if (!id) throw new Error('That doesn’t look like a Google Sheets link.');
  const res = await fetch(exportUrlFor(id), { redirect: 'follow' });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Sheet isn’t accessible — set sharing to “Anyone with the link → Viewer”.');
    }
    throw new Error(`Could not fetch the sheet (HTTP ${res.status}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // A real .xlsx is a zip ("PK"). If we got HTML, sharing is wrong.
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('Got a login page instead of the file — set sharing to “Anyone with the link → Viewer”.');
  }
  return buf;
}

export async function ensureAthlete(db: DB, name: string, email: string): Promise<string> {
  const [existing] = await db.select().from(athletes).where(eq(athletes.email, email)).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(athletes)
    .values({ fullName: name, email, timezone: 'America/Los_Angeles' })
    .returning({ id: athletes.id });
  return created.id;
}

export interface SheetImportInput {
  url: string;
  name: string;
  email: string;
  year: number;
}

export async function importFromSheetUrl(
  db: DB,
  input: SheetImportInput,
): Promise<ImportResult & { athleteId: string }> {
  const buf = await fetchSheetBuffer(input.url);
  const days = await parseTrainingLogBuffer(buf, { year: input.year });
  if (days.length === 0) {
    throw new Error('No weekly training data found in that sheet.');
  }
  const athleteId = await ensureAthlete(db, input.name.trim(), input.email.trim().toLowerCase());
  const result = await importParsedDays(db, athleteId, days, { fileName: `gsheet:${parseSheetId(input.url)}` });
  await groundAnchorAfterImport(db, athleteId);
  return { ...result, athleteId };
}

export interface MultiImportInput {
  name: string;
  email: string;
  files: { url: string; year: number }[];
}

export interface MultiImportResult {
  athleteId: string;
  totals: ImportResult;
  perFile: { url: string; ok: boolean; error?: string; result?: ImportResult }[];
}

/**
 * Import several training-log links for ONE athlete (e.g. one file per season).
 * A bad link is reported per-file and doesn't abort the rest; imports are
 * idempotent so re-sharing the same file is safe.
 */
export async function importMultipleSheets(db: DB, input: MultiImportInput): Promise<MultiImportResult> {
  if (!input.files?.length) throw new Error('No files provided.');
  const athleteId = await ensureAthlete(db, input.name.trim(), input.email.trim().toLowerCase());
  const totals: ImportResult = { days: 0, rawEvents: 0, activities: 0, dateBugFixes: 0, pacesParsed: 0, wellness: 0 };
  const perFile: MultiImportResult['perFile'] = [];

  for (const f of input.files) {
    try {
      const buf = await fetchSheetBuffer(f.url);
      const days = await parseTrainingLogBuffer(buf, { year: f.year });
      if (days.length === 0) throw new Error('No weekly training data found.');
      const result = await importParsedDays(db, athleteId, days, {
        fileName: `gsheet:${parseSheetId(f.url)}`,
      });
      totals.days += result.days;
      totals.rawEvents += result.rawEvents;
      totals.activities += result.activities;
      totals.dateBugFixes += result.dateBugFixes;
      totals.pacesParsed += result.pacesParsed;
      totals.wellness += result.wellness;
      perFile.push({ url: f.url, ok: true, result });
    } catch (e) {
      perFile.push({ url: f.url, ok: false, error: e instanceof Error ? e.message : 'Import failed.' });
    }
  }
  await groundAnchorAfterImport(db, athleteId);
  return { athleteId, totals, perFile };
}

export interface UploadedFile {
  name: string;
  buffer: Buffer;
  year: number;
}

/** Import one or more UPLOADED training-log files for one athlete (any format). */
export async function importUploadedFiles(
  db: DB,
  input: { name: string; email: string; files: UploadedFile[] },
): Promise<MultiImportResult> {
  if (!input.files?.length) throw new Error('No files provided.');
  const athleteId = await ensureAthlete(db, input.name.trim(), input.email.trim().toLowerCase());
  const totals: ImportResult = { days: 0, rawEvents: 0, activities: 0, dateBugFixes: 0, pacesParsed: 0, wellness: 0 };
  const perFile: MultiImportResult['perFile'] = [];

  for (const f of input.files) {
    try {
      const days = await parseTrainingLogBuffer(f.buffer, { year: f.year });
      if (days.length === 0) throw new Error('No training data found.');
      const result = await importParsedDays(db, athleteId, days, { fileName: f.name });
      totals.days += result.days;
      totals.rawEvents += result.rawEvents;
      totals.activities += result.activities;
      totals.dateBugFixes += result.dateBugFixes;
      totals.pacesParsed += result.pacesParsed;
      totals.wellness += result.wellness;
      perFile.push({ url: f.name, ok: true, result });
    } catch (e) {
      perFile.push({ url: f.name, ok: false, error: e instanceof Error ? e.message : 'Import failed.' });
    }
  }
  await groundAnchorAfterImport(db, athleteId);
  return { athleteId, totals, perFile };
}
