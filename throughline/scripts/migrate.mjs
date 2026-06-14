/**
 * Build-time migration runner. Applies pending Drizzle migrations, but:
 *  - on Vercel with no DATABASE_URL → fail LOUDLY (so a stale-schema deploy can
 *    never ship silently, which is how prod fell behind before);
 *  - locally with no DATABASE_URL → skip (local builds use file-backed PGlite,
 *    which self-migrates on first use).
 */
import { execSync } from 'node:child_process';

const url = process.env.DATABASE_URL;
const onVercel = !!process.env.VERCEL;

if (!url) {
  if (onVercel) {
    console.error('[migrate] DATABASE_URL is missing on the Vercel build — refusing to ship with an unmigrated schema.');
    process.exit(1);
  }
  console.log('[migrate] No DATABASE_URL — skipping migrations (local build; PGlite self-migrates).');
  process.exit(0);
}

console.log('[migrate] Applying pending migrations…');
execSync('drizzle-kit migrate', { stdio: 'inherit' });
console.log('[migrate] Done.');
