'use client';
/**
 * Vercel Analytics with account ids stripped from every recorded URL, the same
 * masking GoatCounter applies (/me/<uuid>/settings → /me/:id/settings).
 */
import { Analytics } from '@vercel/analytics/next';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function VercelAnalyticsMasked() {
  return <Analytics beforeSend={(event) => ({ ...event, url: event.url.replace(UUID, ':id').replace(/([?&]t=)[^&]+/, '$1:token') })} />;
}
