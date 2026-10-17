'use client';
/**
 * Records the athlete's timezone from their browser, so "today", check-ins,
 * and morning nudges follow their own clock. Runs when the stored zone differs
 * from the device's (first visit, or after moving/travel), then refreshes so
 * the page re-renders on the right day. Renders nothing.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function TimezoneSync({ athleteId, stored }: { athleteId: string; stored: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!tz || tz === stored) return;
    let cancelled = false;
    fetch(`/api/athletes/${athleteId}/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: tz }),
    })
      .then((r) => {
        if (r.ok && !cancelled) router.refresh();
      })
      .catch(() => {
        /* best-effort; the app falls back to its default timezone */
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId, stored, router]);
  return null;
}
