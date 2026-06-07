'use client';

import { useState } from 'react';

/**
 * One-tap calendar subscription. `webcal://` makes Apple/Google/Outlook offer to
 * SUBSCRIBE (auto-refreshing) rather than import a static copy. We also expose a
 * copyable URL for clients that need to paste it. The origin is read at click
 * time (client-only) to avoid SSR/CSR hydration mismatch.
 */
export function CalendarSubscribe({ athleteId }: { athleteId: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/api/athletes/${athleteId}/calendar.ics`;

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
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
        >
          Add to my calendar
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      <p className="text-xs text-slate-400">
        Subscribes to your plan — new and changed workouts update automatically.
      </p>
    </div>
  );
}
