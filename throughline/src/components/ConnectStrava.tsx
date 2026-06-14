'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Strava connection control. Connect when unlinked; once linked, run a chunked
 * import. The import calls the resumable sync endpoint in a loop (each call
 * handles a bounded number of pages and returns a cursor), so it works for any
 * history size — 200 activities or 20,000 — without hitting a request timeout,
 * and shows live progress.
 */
export function ConnectStrava({
  athleteId,
  connected,
  configured,
  lastActivityDay,
  autoImport,
}: {
  athleteId: string;
  connected: boolean;
  configured: boolean;
  lastActivityDay?: string | null;
  /** Just came back from connecting (?import=1) — run the import automatically. */
  autoImport?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const autoStarted = useRef(false);

  // Auto-run the history import right after connecting — no manual click.
  useEffect(() => {
    if (autoImport && connected && configured && !autoStarted.current) {
      autoStarted.current = true;
      run(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoImport, connected, configured]);

  async function run(full: boolean) {
    setRunning(true);
    setMsg(full ? 'Importing your history…' : 'Syncing…');
    let total = 0;
    let url = `/api/athletes/${athleteId}/strava/sync${full ? '?full=1' : ''}`;
    try {
      // Safety cap on iterations (covers ~40k activities at 1000/call).
      for (let i = 0; i < 60; i++) {
        const res = await fetch(url, { method: 'POST' });
        const j = await res.json();
        if (!j.ok) {
          setMsg(j.error ?? 'Sync failed.');
          break;
        }
        total += j.fetched ?? 0;
        if (j.done || j.nextAfter == null) {
          setMsg(`Done — ${total} activities synced.`);
          setTimeout(() => window.location.reload(), 1200);
          break;
        }
        setMsg(`Imported ${total} activities…`);
        url = `/api/athletes/${athleteId}/strava/sync?after=${j.nextAfter}`;
      }
    } catch {
      setMsg('Network error during sync.');
    } finally {
      setRunning(false);
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

  const neverImported = !lastActivityDay;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-orange-400/15 px-2 py-0.5 text-xs font-medium text-orange-200 ring-1 ring-inset ring-orange-400/30">
          Strava connected ✓
        </span>
        {lastActivityDay && <span className="text-xs text-slate-400">last activity {lastActivityDay}</span>}
        {neverImported ? (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={running}
            className="rounded bg-sky-700 px-3 py-1 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {running ? 'Importing…' : 'Import Strava history'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => run(false)}
              disabled={running}
              className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {running ? 'Working…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={() => run(true)}
              disabled={running}
              className="rounded border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              Re-import all
            </button>
          </>
        )}
      </div>
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
