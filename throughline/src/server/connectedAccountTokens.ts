/**
 * Read side of token encryption for connected_accounts rows: decrypt the
 * stored tokens for use, and re-seal any legacy plaintext row in place (once).
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { connectedAccounts } from '@/db/schema';
import { isSealed, openToken, sealToken } from './tokenCrypto';

type TokenRow = { id: string; accessToken: string | null; refreshToken: string | null };

export async function openAccountTokens<T extends TokenRow>(db: DB, row: T): Promise<T> {
  const legacy = (row.accessToken && !isSealed(row.accessToken)) || (row.refreshToken && !isSealed(row.refreshToken));
  if (legacy) {
    try {
      await db
        .update(connectedAccounts)
        .set({ accessToken: sealToken(row.accessToken), refreshToken: sealToken(row.refreshToken) })
        .where(eq(connectedAccounts.id, row.id));
    } catch {
      /* best-effort; the next read retries */
    }
  }
  return { ...row, accessToken: openToken(row.accessToken), refreshToken: openToken(row.refreshToken) };
}

/** Seal every legacy plaintext token (idempotent). Run from the daily cron. */
export async function sealLegacyTokens(db: DB): Promise<number> {
  const rows = await db
    .select({ id: connectedAccounts.id, accessToken: connectedAccounts.accessToken, refreshToken: connectedAccounts.refreshToken })
    .from(connectedAccounts);
  let n = 0;
  for (const r of rows) {
    if ((r.accessToken && !isSealed(r.accessToken)) || (r.refreshToken && !isSealed(r.refreshToken))) {
      await db
        .update(connectedAccounts)
        .set({ accessToken: sealToken(r.accessToken), refreshToken: sealToken(r.refreshToken) })
        .where(eq(connectedAccounts.id, r.id));
      n++;
    }
  }
  return n;
}
