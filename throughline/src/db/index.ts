/**
 * DB entrypoint. `getDb()` returns the (memoized) drizzle client — Neon in
 * production, file-backed PGlite in local dev. See client.ts.
 */
export { getDb, schema, type DB } from './client';
