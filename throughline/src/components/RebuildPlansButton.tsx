'use client';

import { useState } from 'react';

/**
 * Coach-console control: regenerate every active athlete's plan from their
 * current state (goal, anchor, volume) so they pick up engine changes (e.g. a
 * new workout library). Calls the coach-gated admin endpoint; confirms first.
 */
export function RebuildPlansButton() {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!window.confirm('Rebuild every active athlete’s plan from their current goal and fitness? Existing planned weeks are replaced.')) return;
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/rebuild-plans', { method: 'POST' });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) {
        const failed = (j.results ?? []).filter((r: { error?: string }) => r.error);
        setMsg(`Rebuilt ${j.rebuilt}/${j.athletes} plans${failed.length ? ` · ${failed.length} failed` : ''}.`);
      } else {
        setMsg(j?.error ?? `Failed (HTTP ${res.status}).`);
      }
    } catch {
      setMsg('Network error.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        title="Regenerate all active athletes' plans with the current engine"
      >
        {running ? 'Rebuilding...' : 'Rebuild all plans'}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}
