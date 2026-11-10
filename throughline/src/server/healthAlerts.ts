/**
 * Tell the athlete when their body status changes in a way that matters:
 * a suspected illness, building fatigue, or the start of a staged return.
 * Channels: web push (installed app / browser) and email, whichever are set up.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes } from '@/db/schema';
import type { BodyStatusView } from './bodyStatus';
import { sendPushToAthlete } from './push';

export function alertContent(view: BodyStatusView): { title: string; body: string } {
  const parts = [view.body, view.planNote, view.question ? `${view.question} Open the app to answer.` : null].filter(Boolean);
  return { title: view.headline, body: parts.join(' ') };
}

/** Returns true if at least one channel delivered. */
export async function sendBodyStatusAlert(db: DB, athleteId: string, view: BodyStatusView): Promise<boolean> {
  const [athlete] = await db
    .select({ email: athletes.email, notifyEmail: athletes.notifyEmail })
    .from(athletes)
    .where(eq(athletes.id, athleteId))
    .limit(1);
  if (!athlete) return false;
  const { title, body } = alertContent(view);
  const url = `/me/${athleteId}?tab=body`;
  let delivered = false;

  try {
    if ((await sendPushToAthlete(db, athleteId, { title, body, url, tag: 'body-status' })) > 0) delivered = true;
  } catch {
    /* try email */
  }

  if (process.env.RESEND_API_KEY && athlete.notifyEmail && athlete.email) {
    try {
      const { sendNudgeEmail } = await import('@/lib/email');
      const base = process.env.APP_BASE_URL ?? 'https://throughline.badoo.net';
      await sendNudgeEmail({ to: athlete.email, subject: title, body, portalUrl: `${base}${url}` });
      delivered = true;
    } catch {
      /* no email channel */
    }
  }
  return delivered;
}
