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

let dbPromise: Promise<DB> | null = null;

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

/** Apply the generated SQL migrations into a fresh PGlite database. */
async function applyMigrations(client: {
  exec: (sql: string) => Promise<unknown>;
  query: (sql: string) => Promise<{ rows: unknown[] }>;
}): Promise<void> {
  // Skip if already applied (the plans table exists).
  const existing = await client.query(
    "select 1 from information_schema.tables where table_name = 'plans'",
  );
  if (existing.rows.length > 0) return;

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
      if (trimmed) await client.exec(trimmed);
    }
  }
}

export function getDb(): Promise<DB> {
  if (!dbPromise) dbPromise = create();
  return dbPromise;
}

export { schema };
