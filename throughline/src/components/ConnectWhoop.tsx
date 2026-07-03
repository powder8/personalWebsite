'use client';

import { useState } from 'react';

interface SyncResult {
  ok: boolean;
  days?: number;
  recoveries?: number;
  sleepRecordsSynced?: number;
  error?: string;
}

export function ConnectWhoop({
  athleteId,
  connected,
  configured,
  latestDay,
  recoveryScore,
  hrv,
}: {
  athleteId: string;
  connected: boolean;
  configured: boolean;
  /** Day (YYYY-MM-DD) of the most recent Whoop data synced, if any. */
  latestDay?: string | null;
  /** Most recent recovery score (0-100), if available. */
  recoveryScore?: number | null;
  /** Most recent HRV in ms, if available. */
  hrv?: number | null;
}) {
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function syncNow() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/whoop/sync`, { method: 'POST' });
      const j: SyncResult = await res.json().catch(() => ({ ok: false, error: 'Bad response.' }));
      if (j.ok) {
        setMsg(`Synced — ${j.recoveries ?? 0} recovery days updated.`);
        setTimeout(() => window.location.reload(), 800);
      } else {
        setMsg(j.error ?? 'Sync failed.');
      }
    } catch {
      setMsg('Network error — please try again.');
    } finally {
      setSyncing(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm text-slate-500">
        Whoop sync isn&apos;t configured yet. Add WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET /
        WHOOP_REDIRECT_URI to enable it.
      </p>
    );
  }

  if (!connected) {
    return (
      <div>
        <a
          href={`/api/whoop/connect?athleteId=${athleteId}`}
          className="inline-flex items-center gap-2 rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Connect Whoop
        </a>
        <p className="mt-2 text-xs text-slate-400">
          Syncs HRV, resting heart rate, sleep stages, and recovery score so your coaching adapts to
          how your body is responding to training.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <span className="inline-flex items-center rounded-full bg-sky-400/15 px-2 py-0.5 text-xs font-medium text-sky-200 ring-1 ring-inset ring-sky-400/30">
        Whoop connected ✓
      </span>

      {/* Reconnect link */}
      <div className="text-[11px] text-slate-400">
        Need to re-authorize?{' '}
        <a
          href={`/api/whoop/connect?athleteId=${athleteId}`}
          className="text-sky-400 underline hover:text-sky-300"
        >
          Reconnect Whoop
        </a>
      </div>

      {/* Latest data snapshot */}
      {latestDay ? (
        <div className="rounded-lg bg-sky-400/10 px-3 py-2.5 ring-1 ring-inset ring-sky-400/20">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {recoveryScore != null && (
              <Chip
                label="Recovery"
                value={`${recoveryScore}%`}
                color={recoveryScore >= 67 ? 'green' : recoveryScore >= 34 ? 'yellow' : 'red'}
              />
            )}
            {hrv != null && (
              <Chip label="HRV" value={`${Math.round(hrv)} ms`} color="blue" />
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Last synced {fmtDay(latestDay)} · new data syncs automatically via webhook.
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-400/10 px-3 py-2 text-xs text-slate-400 ring-1 ring-inset ring-slate-400/20">
          Connected, but no data synced yet. Tap &quot;Sync now&quot; to pull recent data.
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="rounded border border-slate-600 px-3 py-1 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
    </div>
  );
}

function Chip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
}) {
  const cls = {
    green: 'text-emerald-300',
    yellow: 'text-amber-300',
    red: 'text-rose-300',
    blue: 'text-sky-300',
  }[color];
  return (
    <div className="flex items-baseline gap-1">
      <span className={`text-base font-bold tabular-nums ${cls}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
