/**
 * In-app feedback capture + review. Lightweight: anyone using the app (Heather)
 * can leave contextual notes; the builder triages them.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { feedback } from '@/db/schema';

export type FeedbackStatus = 'open' | 'addressed';

export interface NewFeedback {
  author?: string;
  path?: string;
  category?: string;
  body: string;
}

export async function createFeedback(db: DB, input: NewFeedback): Promise<void> {
  const body = (input.body ?? '').trim();
  if (!body) throw new Error('Feedback body is required.');
  await db.insert(feedback).values({
    author: (input.author ?? 'Heather').trim() || 'Heather',
    path: input.path ?? null,
    category: input.category ?? null,
    body,
  });
}

export async function listFeedback(
  db: DB,
  statuses: FeedbackStatus[] = ['open', 'addressed'],
) {
  return db
    .select()
    .from(feedback)
    .where(inArray(feedback.status, statuses))
    .orderBy(desc(feedback.createdAt));
}

export async function setFeedbackStatus(db: DB, id: string, status: FeedbackStatus): Promise<void> {
  await db
    .update(feedback)
    .set({ status, addressedAt: status === 'addressed' ? new Date() : null })
    .where(eq(feedback.id, id));
}

export async function countOpenFeedback(db: DB): Promise<number> {
  const rows = await db.select({ id: feedback.id }).from(feedback).where(eq(feedback.status, 'open'));
  return rows.length;
}
