'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Strava connection control. Connect when unlinked; once linked, run a chunked
 * import. The import calls the resumable sync endpoint in a loop (each call
 * handles a bounded number of pages and returns a cursor), so it works for any
 * history size — 200 activities or 20,000 — without hitting a request timeout.
 *
 * Robustness (a long import used to strand silently):
 *  - Progress (the resume cursor) is persisted to localStorage every chunk, so a
 *    closed/reloaded tab RESUMES instead of starting over or stalling.
 *  - Strava rate limits (429) are handled: we back off the suggested time and
 *    continue from the saved cursor rather than dying.
 *  - A non-advancing cursor or repeated failure stops cleanly with a real
 *    message — never an invisible hang.
 */

interface SyncResponse {
  ok: boolean;
  fetched?: number;
  done?: boolean;
  nextAfter?: number | null;
  rateLimited?: boolean;
  retryAfterSec?: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ConnectStrava({
  athleteId,
  connected,
  configured,
  lastActivityDay,
  firstActivityDay,
  activityCount = 0,
  autoImport,
}: {
  athleteId: string;
  connected: boolean;
  configured: boolean;
  lastActivityDay?: string | null;
  firstActivityDay?: string | null;
  activityCount?: number;
  /** Just came back from connecting (?import=1) — run the import automatically. */
  autoImport?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const started = useRef(false); // guard against double-start (StrictMode / re-render)

  const progressKey = `tl_import_${athleteId}`;
  const readCursor = (): number | null => {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage.getItem(progressKey);
    return v == null ? null : Number(v);
  };
  const writeCursor = (after: number | null) => {
    if (typeof window === 'undefined') return;
    if (after == null) window.localStorage.removeItem(progressKey);
    else window.localStorage.setItem(progressKey, String(after));
  };

  // First effect to fire wins (one import at a time): a just-connected full
  // import, an interrupted import to resume, or a quiet recent-activity sync.
  useEffect(() => {
    if (!connected || !configured || started.current) return;
    started.current = true;

    if (autoImport) {
      run({ full: true });
    } else if (readCursor() != null) {
      // An import was interrupted (closed tab, rate limit) — pick it back up.
      run({ resume: true });
    } else if (typeof window !== 'undefined' && !sessionStorage.getItem('tl_recentSync')) {
      sessionStorage.setItem('tl_recentSync', '1');
      run({ full: false, silent: true });
    } else {
      started.current = false; // nothing to do this load; allow manual buttons
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoImport, connected, configured]);

  async function run({
    full = false,
    silent = false,
    resume = false,
  }: { full?: boolean; silent?: boolean; resume?: boolean }) {
    setRunning(true);
    if (!silent) setMsg(full || resume ? 'Importing your history…' : 'Syncing…');

    let total = 0;
    let after: number | null = resume ? readCursor() : null;
    let url = after != null ? `?after=${after}` : full ? '?full=1' : '';
    let consecutiveErrors = 0;

    try {
      // Iteration cap covers ~40k activities at 1000/call, with headroom for
      // rate-limit pauses; the cursor guard below ends it the moment we stop
      // making progress.
      for (let i = 0; i < 200; i++) {
        let res: Response;
        try {
          res = await fetch(`/api/athletes/${athleteId}/strava/sync${url}`, { method: 'POST' });
        } catch {
          if (++consecutiveErrors >= 3) {
            if (!silent) setMsg('Network trouble — your progress is saved. Tap “Sync now” to resume.');
            break;
          }
          await sleep(2000);
          continue;
        }
        const j: SyncResponse = await res.json().catch(() => ({ ok: false, error: 'Bad response.' }));

        if (!j.ok) {
          if (!silent) setMsg(j.error ?? 'Sync failed — progress saved; tap “Sync now” to resume.');
          break;
        }
        consecutiveErrors = 0;
        total += j.fetched ?? 0;

        // Rate limited: persist where we are and back off (or stop if the wait
        // is long), so we never silently spin.
        if (j.rateLimited) {
          if (j.nextAfter != null) writeCursor(j.nextAfter);
          const wait = j.retryAfterSec ?? 120;
          if (wait > 180) {
            if (!silent) setMsg(`Strava’s rate limit hit (${total} so far). Progress saved — tap “Sync now” in a few minutes to continue.`);
            break;
          }
          if (!silent) setMsg(`Strava rate limit — pausing ${wait}s, then continuing… (${total} so far)`);
          await sleep(wait * 1000);
          url = j.nextAfter != null ? `?after=${j.nextAfter}` : url;
          continue;
        }

        if (j.done || j.nextAfter == null) {
          writeCursor(null); // finished — clear resume state
          if (!silent) setMsg(total > 0 ? `Done — ${total} activities synced.` : 'You’re up to date — nothing new to import.');
          if (!silent || total > 0) setTimeout(() => window.location.reload(), silent ? 250 : 1200);
          break;
        }

        // Guard: the cursor must move forward, else we'd loop forever.
        if (after != null && j.nextAfter <= after) {
          writeCursor(null);
          if (!silent) setMsg(`Done — ${total} activities synced.`);
          if (total > 0) setTimeout(() => window.location.reload(), 1200);
          break;
        }

        after = j.nextAfter;
        writeCursor(after);
        url = `?after=${after}`;
        if (!silent) setMsg(`Imported ${total} activities…`);
      }
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

  const imported = activityCount > 0 || !!lastActivityDay;
  return (
    <div className="space-y-2">
      <span className="inline-flex items-center rounded-full bg-orange-400/15 px-2 py-0.5 text-xs font-medium text-orange-200 ring-1 ring-inset ring-orange-400/30">
        Strava connected ✓
      </span>

      {/* Unambiguous import state: imported (with proof) vs not yet. */}
      {imported ? (
        <div className="rounded-lg bg-emerald-400/10 px-3 py-2 text-xs ring-1 ring-inset ring-emerald-400/20">
          <div className="font-semibold text-emerald-300">
            ✓ {activityCount > 0 ? `${activityCount.toLocaleString()} ` : ''}activit{activityCount === 1 ? 'y' : 'ies'} imported
          </div>
          <div className="mt-0.5 text-slate-400">
            {firstActivityDay && firstActivityDay !== lastActivityDay
              ? `${fmtDate(firstActivityDay)} → ${fmtDate(lastActivityDay)}`
              : lastActivityDay
                ? `last activity ${fmtDate(lastActivityDay)}`
                : null}
            {' · new runs sync automatically.'}
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-400/10 px-3 py-2 text-xs text-slate-400 ring-1 ring-inset ring-slate-400/20">
          Connected, but no activities imported yet. Tap below to pull your history.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!imported ? (
          <button
            type="button"
            onClick={() => run({ full: true })}
            disabled={running}
            className="rounded bg-sky-700 px-3 py-1 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {running ? 'Importing…' : 'Import Strava history'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => run({ full: false })}
              disabled={running}
              className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {running ? 'Working…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={() => run({ full: true })}
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(day: string | null | undefined): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
