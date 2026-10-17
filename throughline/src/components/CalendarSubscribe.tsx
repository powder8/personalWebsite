'use client';

import { useState } from 'react';

/**
 * One-tap calendar subscription. `webcal://` makes Apple/Google/Outlook offer to
 * SUBSCRIBE (auto-refreshing) rather than import a static copy. We also expose a
 * copyable URL for clients that need to paste it. The origin is read at click
 * time (client-only) to avoid SSR/CSR hydration mismatch.
 */
export function CalendarSubscribe({ athleteId, token }: { athleteId: string; token: string | null }) {
  const [copied, setCopied] = useState(false);
  // The token lets the calendar app fetch the feed without your login.
  const path = `/api/athletes/${athleteId}/calendar.ics${token ? `?t=${token}` : ''}`;

  function subscribe() {
    const host = window.location.host;
    window.location.href = `webcal://${host}${path}`;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={subscribe}
          className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-slate-800"
        >
          Add to my calendar
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded-full bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      <p className="text-xs text-slate-400">
        Subscribes to your plan, so new and changed workouts update automatically. Keep the link private: anyone with
        it can see your plan.
      </p>
    </div>
  );
}
