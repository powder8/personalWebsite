'use client';

import { useState } from 'react';

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

type Horizon = 'today' | 'next3' | 'week' | 'range' | 'ongoing';
type Type = 'pace_adjust' | 'reduce_volume' | 'unavailable';

export function AdjustmentForm({ athleteId, today }: { athleteId: string; today: string }) {
  const [type, setType] = useState<Type>('unavailable');
  const [horizon, setHorizon] = useState<Horizon>('today');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function windowFor(h: Horizon, fromInput: string, toInput: string): { from: string; to: string | null } {
    switch (h) {
      case 'today':
        return { from: today, to: today };
      case 'next3':
        return { from: today, to: addDays(today, 2) };
      case 'week':
        return { from: today, to: addDays(today, 6) };
      case 'ongoing':
        return { from: today, to: null };
      case 'range':
        return { from: fromInput || today, to: toInput || fromInput || today };
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const { from, to } = windowFor(horizon, String(fd.get('from') || ''), String(fd.get('to') || ''));
    const body: Record<string, unknown> = { type, from, to, label: String(fd.get('label') || '') };
    if (type === 'pace_adjust') body.deltaSecPerMile = Number(fd.get('delta') || 0);
    if (type === 'reduce_volume') body.factor = Number(fd.get('pct') || 100) / 100;

    try {
      const res = await fetch(`/api/athletes/${athleteId}/directives`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) window.location.reload();
      else {
        setErr(json.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  const field = 'mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm';

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">
          Adjustment
          <select value={type} onChange={(e) => setType(e.target.value as Type)} className={`block ${field}`}>
            <option value="unavailable">Unavailable (rest) — travel / busy / sick</option>
            <option value="pace_adjust">Slower paces</option>
            <option value="reduce_volume">Shorter (reduce volume)</option>
          </select>
        </label>

        {type === 'pace_adjust' && (
          <label className="text-xs text-slate-600">
            Slower by (s/mi)
            <input name="delta" type="number" defaultValue={20} className={`block w-24 ${field}`} />
          </label>
        )}
        {type === 'reduce_volume' && (
          <label className="text-xs text-slate-600">
            Volume (% of plan)
            <input name="pct" type="number" defaultValue={70} className={`block w-24 ${field}`} />
          </label>
        )}

        <label className="text-xs text-slate-600">
          When
          <select value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)} className={`block ${field}`}>
            <option value="today">Today</option>
            <option value="next3">Next 3 days</option>
            <option value="week">This week</option>
            <option value="range">Date range…</option>
            <option value="ongoing">Ongoing</option>
          </select>
        </label>

        {horizon === 'range' && (
          <>
            <label className="text-xs text-slate-600">
              From
              <input name="from" type="date" defaultValue={today} className={`block ${field}`} />
            </label>
            <label className="text-xs text-slate-600">
              To
              <input name="to" type="date" defaultValue={today} className={`block ${field}`} />
            </label>
          </>
        )}
      </div>

      <label className="block text-xs text-slate-600">
        Reason / note
        <input name="label" placeholder="e.g. Out of town, achilles niggle, work crunch" className={`w-full ${field}`} />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add adjustment'}
      </button>
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </form>
  );
}
