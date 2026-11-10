/**
 * Web Push delivery (VAPID). Works in desktop browsers, Android, and iOS when
 * the app is installed to the home screen. Unconfigured (no VAPID keys) means
 * every send is a quiet no-op.
 */
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import type { DB } from '@/db';
import { pushSubscriptions } from '@/db/schema';

export interface PushPayload {
  title: string;
  body: string;
  /** Path to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
}

export function pushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let configured = false;
function client() {
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'https://throughline.badoo.net', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return webpush;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function isValidSubscription(s: unknown): s is SubscriptionInput {
  const x = s as SubscriptionInput | null;
  if (!x || typeof x.endpoint !== 'string' || !x.keys || typeof x.keys.p256dh !== 'string' || typeof x.keys.auth !== 'string') return false;
  if (x.endpoint.length > 2000 || x.keys.p256dh.length > 300 || x.keys.auth.length > 100) return false;
  try {
    // Only real push services: we POST to this URL from the server.
    return new URL(x.endpoint).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function saveSubscription(db: DB, athleteId: string, sub: SubscriptionInput, userAgent: string | null): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ athleteId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { athleteId, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
}

export async function removeSubscription(db: DB, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function countSubscriptions(db: DB, athleteId: string): Promise<number> {
  return (await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.athleteId, athleteId))).length;
}

/** Send to every device the athlete enabled. Returns how many were delivered. */
export async function sendPushToAthlete(db: DB, athleteId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.athleteId, athleteId));
  let delivered = 0;
  for (const s of subs) {
    try {
      await client().sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 12 * 3600, urgency: 'normal' });
      delivered++;
      await db.update(pushSubscriptions).set({ lastOkAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: the browser dropped this subscription. Forget it.
      if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    }
  }
  return delivered;
}
