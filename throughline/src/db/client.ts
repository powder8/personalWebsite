/**
 * Database client.
 *
 *  - Production / when DATABASE_URL is set: Neon serverless (HTTP driver).
 *  - Local dev (no DATABASE_URL): a file-backed PGlite instance — real Postgres
 *    in-process — auto-migrated and seeded on first use, so `npm run dev` works
 *    with zero external setup. The coach can click around immediately.
 *
 * getDb() is async (PGlite init is async) and memoized.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

// Memoize on globalThis, NOT a module-level variable. Next's App Router bundles
// each route/page separately, so a module-level singleton would be duplicated
// (one PGlite instance per route → writes invisible across routes). globalThis
// is shared across all bundles in the process, giving a single shared instance.
const globalForDb = globalThis as unknown as { __throughlineDb?: Promise<DB> };

function isNeonUrl(url: string | undefined): url is string {
  return !!url && !url.includes('localhost');
}

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;

  if (isNeonUrl(url)) {
    const { drizzle } = await import('drizzle-orm/neon-http');
    const { neon } = await import('@neondatabase/serverless');
    return drizzle(neon(url), { schema }) as unknown as DB;
  }

  // Local dev: file-backed PGlite.
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite(process.env.PGLITE_DIR ?? '.pgdata');
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as DB;

  await applyMigrations(client);
  const { seedIfEmpty } = await import('./seed');
  await seedIfEmpty(db);
  return db;
}

/**
 * Apply the generated SQL migrations into the PGlite database. Tolerant of
 * re-application: statements for objects that already exist are skipped, so
 * adding a new table to an existing local DB doesn't require wiping data.
 */
async function applyMigrations(client: {
  exec: (sql: string) => Promise<unknown>;
}): Promise<void> {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'drizzle');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      try {
        await client.exec(trimmed);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already exists/i.test(msg)) continue; // object exists → fine
        throw e;
      }
    }
  }
}

export function getDb(): Promise<DB> {
  if (!globalForDb.__throughlineDb) globalForDb.__throughlineDb = create();
  return globalForDb.__throughlineDb;
}

export { schema };
