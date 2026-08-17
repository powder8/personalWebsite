'use client';

import { useState } from 'react';

/**
 * Compact "pull my latest runs from Strava now" control for the main view.
 * New runs normally arrive on their own via the Strava webhook, but it can lag a
 * minute or two — this is the manual fallback for "I just ran, show it now".
 * Reloads only if something new came in.
 */
export function SyncButton({ athleteId }: { athleteId: string }) {
  const [state, setState] = useState<'idle' | 'syncing' | 'done' | 'uptodate' | 'error'>('idle');

  async function sync() {
    setState('syncing');
    try {
      let total = 0;
      let url = `/api/athletes/${athleteId}/strava/sync`;
      // A couple of chunks covers anything logged since the last sync.
      for (let i = 0; i < 5; i++) {
        const res = await fetch(url, { method: 'POST' });
        const j = await res.json().catch(() => ({ ok: false }));
        if (!j.ok) {
          setState('error');
          return;
        }
        total += j.fetched ?? 0;
        if (j.done || j.nextAfter == null) break;
        url = `/api/athletes/${athleteId}/strava/sync?after=${j.nextAfter}`;
      }
      if (total > 0) {
        setState('done');
        setTimeout(() => window.location.reload(), 600);
      } else {
        setState('uptodate');
        setTimeout(() => setState('idle'), 2500);
      }
    } catch {
      setState('error');
    }
  }

  const label =
    state === 'syncing' ? 'Syncing...' : state === 'done' ? 'Synced ✓' : state === 'uptodate' ? 'Up to date' : state === 'error' ? 'Retry sync' : '↻ Sync';

  return (
    <button
      type="button"
      onClick={sync}
      disabled={state === 'syncing'}
      className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-600/40 transition hover:bg-white/5 disabled:opacity-60"
      title="Pull your latest Strava activities now"
    >
      {label}
    </button>
  );
}
