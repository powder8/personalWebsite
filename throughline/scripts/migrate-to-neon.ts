/**
 * One-time data migration: copy the local dev database (file-backed PGlite in
 * .pgdata) into a cloud Postgres (Neon) so a fresh deploy keeps EVERYTHING —
 * Heather's merged record, season setup, imported activities/sleep, the demo
 * roster, plans, directives, etc. — not just what re-seeding/re-importing would
 * recreate.
 *
 * Ids are preserved and inserts use ON CONFLICT DO NOTHING, so the script is
 * safe to re-run and won't clobber rows already in the destination.
 *
 * Run the schema migration on the destination FIRST, then this:
 *   DATABASE_URL="<neon-url>" npm run db:migrate
 *   DEST_DATABASE_URL="<neon-url>" PGLITE_DIR=.pgdata tsx scripts/migrate-to-neon.ts
 */
import * as schema from '@/db/schema';
import type { PgTable } from 'drizzle-orm/pg-core';

// Tables in FK-dependency order: parents before children.
const ORDER = [
  'athletes',
  'engineSettings',
  'intakeProfiles',
  'races',
  'escalations',
  'feedback',
  'connectedAccounts',
  'checkIns',
  'baselines',
  'fitnessFatigueStates',
  'directives',
  'injuryRecords',
  'athleteNotes',
  'overrides',
  'readinessAssessments',
  'dailySummaries',
  'sleepRecords',
  'hrvRecords',
  'restingHrRecords',
  'rawEvents', // before activities (activities.rawEventId → rawEvents)
  'activities',
  'plans', // before plannedSessions
  'plannedSessions',
] as const;

async function main() {
  const destUrl = process.env.DEST_DATABASE_URL;
  if (!destUrl) throw new Error('Set DEST_DATABASE_URL to the Neon connection string.');
  const pgliteDir = process.env.PGLITE_DIR ?? '.pgdata';

  // --- source: local PGlite ---
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const sourceClient = new PGlite(pgliteDir);
  await sourceClient.waitReady;
  const source = drizzlePglite(sourceClient, { schema });

  // --- destination: Neon (same driver prod uses) ---
  const { drizzle: drizzleNeon } = await import('drizzle-orm/neon-http');
  const { neon } = await import('@neondatabase/serverless');
  const dest = drizzleNeon(neon(destUrl), { schema });

  const tables = schema as unknown as Record<string, PgTable>;
  let totalRows = 0;
  for (const name of ORDER) {
    const tbl = tables[name];
    const rows = await source.select().from(tbl);
    if (rows.length === 0) {
      console.log(`  ${name}: 0`);
      continue;
    }
    const CHUNK = 200; // stay under statement parameter limits
    for (let i = 0; i < rows.length; i += CHUNK) {
      await dest.insert(tbl).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
    }
    totalRows += rows.length;
    console.log(`  ${name}: ${rows.length}`);
  }

  console.log(`\nDone. Copied ${totalRows} rows from ${pgliteDir} → Neon.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
