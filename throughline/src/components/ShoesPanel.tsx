'use client';

import { useState } from 'react';
import type { ShoeWithMileage, RecentRun } from '@/server/shoes';

/**
 * Shoe mileage tracking (Strava-style). Add pairs, see accrued miles + a wear
 * bar, set the default pair (auto-assigned to new runs), retire/delete, and
 * reassign individual recent runs to a different pair.
 */
export function ShoesPanel({
  athleteId,
  shoes,
  recentRuns,
}: {
  athleteId: string;
  shoes: ShoeWithMileage[];
  recentRuns: RecentRun[];
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(shoes.length === 0);

  async function post(body: Record<string, unknown>, path = `/api/athletes/${athleteId}/shoes`) {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (j.ok) window.location.reload();
      else {
        setErr(j.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await post({
      action: 'add',
      name: String(fd.get('name') || '').trim(),
      brand: String(fd.get('brand') || '').trim() || null,
      startDate: String(fd.get('startDate') || '') || null,
      initialMiles: Number(fd.get('initialMiles') || 0),
      maxMiles: Number(fd.get('maxMiles') || 500),
      isDefault: fd.get('isDefault') === 'on',
    });
  }

  const field = 'mt-0.5 rounded border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <div className="space-y-4">
      {shoes.length > 0 && (
        <ul className="space-y-3">
          {shoes.map((s) => (
            <li key={s.id} className={`rounded-lg border p-3 ${s.retiredAt ? 'border-slate-200 bg-slate-50/60 opacity-70' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-slate-800">{s.name}</span>
                  {s.brand && <span className="ml-1 text-xs text-slate-400">{s.brand}</span>}
                  {s.isDefault && !s.retiredAt && (
                    <span className="ml-2 rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">default</span>
                  )}
                  {s.retiredAt && (
                    <span className="ml-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">retired</span>
                  )}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <span className="font-semibold tabular-nums text-slate-800">{s.miles.toFixed(0)}</span>
                  <span className="text-slate-400"> / {s.maxMiles.toFixed(0)} mi</span>
                </div>
              </div>
              {/* wear bar */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${s.wearPct >= 1 ? 'bg-rose-500' : s.wearPct >= 0.85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, Math.round(s.wearPct * 100))}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {s.runs} run{s.runs === 1 ? '' : 's'}
                  {s.wearPct >= 1 ? ' · past recommended, consider replacing' : s.wearPct >= 0.85 ? ' · getting worn' : ''}
                </span>
                <div className="flex gap-2 text-[11px]">
                  {!s.retiredAt && !s.isDefault && (
                    <button disabled={pending} onClick={() => post({ action: 'default', shoeId: s.id })} className="text-sky-300 hover:underline disabled:opacity-50">
                      Make default
                    </button>
                  )}
                  {!s.retiredAt && (
                    <button disabled={pending} onClick={() => post({ action: 'retire', shoeId: s.id })} className="text-slate-500 hover:underline disabled:opacity-50">
                      Retire
                    </button>
                  )}
                  <button disabled={pending} onClick={() => post({ action: 'delete', shoeId: s.id })} className="text-rose-600 hover:underline disabled:opacity-50">
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={onAdd} className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-600">
              Name
              <input name="name" required placeholder="Vaporfly 3" className={`block w-full ${field}`} />
            </label>
            <label className="text-xs text-slate-600">
              Brand (optional)
              <input name="brand" placeholder="Nike" className={`block w-full ${field}`} />
            </label>
            <label className="text-xs text-slate-600">
              In service since
              <input name="startDate" type="date" className={`block w-full ${field}`} />
            </label>
            <label className="text-xs text-slate-600">
              Miles already on them
              <input name="initialMiles" type="number" min={0} defaultValue={0} className={`block w-full ${field}`} />
            </label>
            <label className="text-xs text-slate-600">
              Replace at (mi)
              <input name="maxMiles" type="number" min={100} defaultValue={500} className={`block w-full ${field}`} />
            </label>
            <label className="flex items-end gap-2 text-xs text-slate-600">
              <input name="isDefault" type="checkbox" defaultChecked={shoes.length === 0} className="mb-2" />
              Default pair
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              {pending ? 'Saving...' : 'Add shoes'}
            </button>
            {shoes.length > 0 && (
              <button type="button" onClick={() => setAdding(false)} className="text-xs text-slate-500 hover:underline">
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-sm font-medium text-sky-300 hover:underline">
          + Add a pair
        </button>
      )}

      {/* Per-run reassignment */}
      {shoes.length > 0 && recentRuns.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Reassign recent runs</div>
          <ul className="space-y-1.5">
            {recentRuns.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/me/${athleteId}/runs/${r.id}`} className="min-w-0 truncate text-sky-300 hover:underline">
                  {r.day} · {r.miles.toFixed(1)} mi{r.name ? ` · ${r.name}` : ''}
                </a>
                <select
                  defaultValue={r.shoeId ?? ''}
                  disabled={pending}
                  onChange={(e) =>
                    post({ shoeId: e.target.value || null }, `/api/athletes/${athleteId}/activities/${r.id}/shoe`)
                  }
                  className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="">- none -</option>
                  {shoes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {err && <p className="text-sm text-rose-600">{err}</p>}
    </div>
  );
}
