'use client';

import { useState } from 'react';

interface Zone {
  key: string;
  label: string;
}

const ZONE_LABELS: Record<string, string> = {
  recovery: 'Recovery',
  easy: 'Easy',
  maintenance: 'Maintenance',
  marathon: 'Marathon',
  threshold: 'Threshold',
  interval: 'Interval',
  rep: 'Rep',
};

export function PaceAdjustForm({ athleteId, zones }: { athleteId: string; zones: Zone[] }) {
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; updatedSessions?: number; error?: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const parsed: Record<string, number> = {};
    for (const [k, v] of Object.entries(deltas)) {
      const n = Number(v);
      if (Number.isFinite(n) && n !== 0) parsed[k] = n;
    }
    try {
      const res = await fetch(`/api/athletes/${athleteId}/zones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deltas: parsed }),
      });
      const json = await res.json();
      setResult(json);
      if (json.ok) setTimeout(() => window.location.reload(), 700);
    } catch {
      setResult({ error: 'Network error.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-slate-500">
        Adjust pace zones for this athlete (seconds per mile; <strong>+ = slower</strong>, − = faster).
        Saved to their model and applied to all future sessions.
      </p>
      <div className="space-y-1.5">
        {zones.map((z) => (
          <div key={z.key} className="flex items-center gap-3 text-sm">
            <span className="w-24 font-medium text-slate-700">{ZONE_LABELS[z.key] ?? z.key}</span>
            <span className="w-28 tabular-nums text-slate-500">{z.label}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="1"
                placeholder="0"
                value={deltas[z.key] ?? ''}
                onChange={(e) => setDeltas((d) => ({ ...d, [z.key]: e.target.value }))}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <span className="text-xs text-slate-400">s/mi</span>
            </div>
          </div>
        ))}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Applying...' : 'Apply pace adjustments'}
      </button>
      {result?.error && (
        <p className="rounded bg-rose-400/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-inset ring-rose-400/30">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p className="rounded bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
          Updated the model and {result.updatedSessions} future session(s). Refreshing...
        </p>
      )}
    </form>
  );
}
