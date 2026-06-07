/**
 * Import coach training-log spreadsheets.
 *
 * Single file:
 *   tsx scripts/import-log.ts --file sample-data/moira-build-2021.xlsx \
 *        --name "Moira" --email moira@example.com --year 2021
 *
 * Batch (one .xlsx per athlete; athlete name derived from the filename):
 *   tsx scripts/import-log.ts --dir sample-data --year 2021
 *
 * Imports into Neon if DATABASE_URL is set, otherwise the local PGlite dev DB
 * (so the coach console picks the data up immediately).
 */
import { readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { parseTrainingLogFile } from '@/providers/manual/parseTrainingLog';
import { importParsedDays } from '@/db/import';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function titleFromFile(path: string): string {
  return basename(path, extname(path))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function slugEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@import.local`;
}

async function ensureAthlete(name: string, email: string): Promise<string> {
  const db = await getDb();
  const [existing] = await db.select().from(athletes).where(eq(athletes.email, email)).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(athletes)
    .values({ fullName: name, email, timezone: 'America/Los_Angeles' })
    .returning({ id: athletes.id });
  return created.id;
}

async function importOne(path: string, name: string, email: string, year: number) {
  const db = await getDb();
  const athleteId = await ensureAthlete(name, email);
  const days = await parseTrainingLogFile(path, { year });
  const res = await importParsedDays(db, athleteId, days, { fileName: basename(path) });
  console.log(
    `✓ ${name.padEnd(24)} ${res.activities} runs · ${res.rawEvents} new events · ` +
      `${res.dateBugFixes} date-bug fixes · ${res.pacesParsed} paces parsed`,
  );
}

async function main() {
  const year = parseInt(arg('year') ?? '2021', 10);
  const dir = arg('dir');
  const file = arg('file');

  if (dir) {
    const files = readdirSync(dir).filter((f) => /\.xlsx?$/.test(f) && !f.startsWith('~'));
    if (!files.length) {
      console.error(`No .xlsx files in ${dir}`);
      process.exit(1);
    }
    console.log(`Importing ${files.length} file(s) from ${dir} (year ${year})\n`);
    for (const f of files.sort()) {
      const name = titleFromFile(f);
      await importOne(join(dir, f), name, slugEmail(name), year);
    }
  } else if (file) {
    const name = arg('name') ?? titleFromFile(file);
    const email = arg('email') ?? slugEmail(name);
    await importOne(file, name, email, year);
  } else {
    console.error('Provide --file <path> or --dir <folder>. See header for usage.');
    process.exit(1);
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
