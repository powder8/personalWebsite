/**
 * Durable sliding-window rate limit. Each allowed call inserts a row; a call is
 * refused when the key already has `max` rows inside any of its windows.
 * Postgres-backed (not in-memory) because serverless instances don't share
 * state. Old rows for the key are pruned as we go.
 */
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { rateLimitEvents } from '@/db/schema';

export interface RateWindow {
  max: number;
  windowMs: number;
}

export type RateDecision = { ok: true } | { ok: false; retryAfterSec: number };

export async function consumeRateLimit(db: DB, key: string, windows: RateWindow[], now = new Date()): Promise<RateDecision> {
  for (const w of windows) {
    const since = new Date(now.getTime() - w.windowMs);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${rateLimitEvents.createdAt})` })
      .from(rateLimitEvents)
      .where(and(eq(rateLimitEvents.key, key), gt(rateLimitEvents.createdAt, since)));
    if ((row?.n ?? 0) >= w.max) {
      const oldest = row?.oldest ? new Date(row.oldest).getTime() : now.getTime();
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + w.windowMs - now.getTime()) / 1000)) };
    }
  }
  await db.insert(rateLimitEvents).values({ key, createdAt: now });
  // Prune beyond the longest window so the table stays small.
  const longest = Math.max(...windows.map((w) => w.windowMs));
  await db.delete(rateLimitEvents).where(and(eq(rateLimitEvents.key, key), lt(rateLimitEvents.createdAt, new Date(now.getTime() - longest))));
  return { ok: true };
}
