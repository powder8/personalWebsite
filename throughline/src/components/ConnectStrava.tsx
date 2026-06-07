'use client';

import { useState } from 'react';

/**
 * Strava connection control. Shows Connect when unlinked, or Connected + a
 * "Sync now" pull when linked. The OAuth redirect is a plain link (server
 * route); sync is a fetch.
 */
export function ConnectStrava({
  athleteId,
  connected,
  configured,
  lastActivityDay,
}: {
  athleteId: string;
  connected: boolean;
  configured: boolean;
  lastActivityDay?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/strava/sync`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        setMsg(`Synced — ${json.imported} new of ${json.fetched} fetched.`);
        setTimeout(() => window.location.reload(), 1000);
      } else setMsg(json.error ?? 'Sync failed.');
    } catch {
      setMsg('Network error.');
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm text-slate-500">
        Strava sync isn’t configured yet. Add an API app’s keys to enable one-tap activity import.
      </p>
    );
  }

  if (!connected) {
    return (
      <div>
        <a
          href={`/api/auth/strava/connect?athleteId=${athleteId}`}
          className="inline-flex items-center gap-2 rounded bg-[#fc4c02] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Connect Strava
        </a>
        <p className="mt-2 text-xs text-slate-400">
          Auto-imports your runs (pace, distance, heart rate) so your plan and readiness stay current.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 ring-1 ring-inset ring-orange-200">
          Strava connected ✓
        </span>
        {lastActivityDay && <span className="text-xs text-slate-400">last activity {lastActivityDay}</span>}
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {pending ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
