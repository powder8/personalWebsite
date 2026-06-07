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
  return { ...result, athleteId };
}
