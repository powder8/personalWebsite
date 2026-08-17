'use client';

import { useState } from 'react';
import type { AdjustmentType } from '@/engine/plan';

/**
 * Athlete-facing "need to adjust your training?" form. The athlete picks the
 * kind of adjustment and the date(s); we translate that into an engine directive
 * the coach reviews:
 *   - Reduced mileage → reduce_volume (lighter week)
 *   - Move workout / Can't train → unavailable (day frees; plan reshuffles)
 * The human-readable choice + description ride along in the label so the coach
 * sees exactly what was asked.
 */
const ADJUSTMENTS: { value: string; label: string; type: AdjustmentType; factor?: number }[] = [
  { value: 'move_workout', label: 'Move workout', type: 'unavailable' },
  { value: 'reduced_mileage', label: 'Reduced mileage', type: 'reduce_volume', factor: 0.65 },
  { value: 'cant_train', label: "Can't train (rest)", type: 'unavailable' },
];

export function AvailabilityForm({ athleteId }: { athleteId: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const from = String(fd.get('from') || '');
    const to = String(fd.get('to') || from);
    const adjValue = String(fd.get('adjustment') || 'move_workout');
    const description = String(fd.get('description') || '').trim();
    const adj = ADJUSTMENTS.find((a) => a.value === adjValue) ?? ADJUSTMENTS[0];
    if (!from) {
      setErr('Pick a start date.');
      setPending(false);
      return;
    }
    const label = description ? `${adj.label}, ${description}` : adj.label;
    try {
      const res = await fetch(`/api/athletes/${athleteId}/directives`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: adj.type, from, to, factor: adj.factor, label }),
      });
      const json = await res.json();
      if (json.ok) {
        setDone(true);
        setTimeout(() => window.location.reload(), 900);
      } else setErr(json.error ?? 'Failed.');
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  const field = 'mt-0.5 rounded border border-slate-300 px-2 py-1.5 text-sm';
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-xs text-slate-600">
        Adjustment needed
        <select name="adjustment" className={`block w-full ${field}`} defaultValue="move_workout">
          {ADJUSTMENTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-600">
          From
          <input name="from" type="date" required className={`block w-full ${field}`} />
        </label>
        <label className="text-xs text-slate-600">
          To (optional)
          <input name="to" type="date" className={`block w-full ${field}`} />
        </label>
        <label className="text-xs text-slate-600">
          Description
          <input name="description" placeholder="Travelling / busy / sick" className={`block w-full ${field}`} />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Saving...' : 'Send adjustment to coach'}
      </button>
      {done && <p className="text-sm text-emerald-300">Got it, your coach will see this and the plan adjusts. 🙌</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </form>
  );
}
