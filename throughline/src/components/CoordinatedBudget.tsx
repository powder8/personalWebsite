'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The shared weekly-hours control for an athlete running BOTH a run goal and a
 * bike goal. Sets one realistic weekly-hours budget; the server splits it by
 * training demand and rebuilds both plans to fit — the "one view of time" so the
 * two goals don't overlap into an impossible week.
 */
export function CoordinatedBudget({
  athleteId,
  currentBudget,
}: {
  athleteId: string;
  currentBudget: number | null;
}) {
  const router = useRouter();
  const [hours, setHours] = useState(currentBudget != null ? String(currentBudget) : '');
  const [priority, setPriority] = useState<'none' | 'run' | 'bike'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [split, setSplit] = useState<{ run?: number; bike?: number } | null>(null);

  async function onCoordinate() {
    const h = Number(hours);
    if (!(h > 0)) {
      setError('Enter your weekly training hours.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/coordinate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weeklyHours: h, priority: priority === 'none' ? undefined : priority }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not coordinate your goals.');
        return;
      }
      setSplit(data.hours ?? null);
      router.refresh();
    } catch {
      setError('Network error, try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-medium text-white/90">Coordinate your week</p>
      <p className="mt-1 text-xs text-white/60">
        One weekly-hours budget, split across your run and bike goals by training demand — so the two don&apos;t stack
        into an impossible week.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-white/60">Weekly hours</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-24 rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-white/40"
            placeholder="8"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-white/60">Priority goal</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as 'none' | 'run' | 'bike')}
            className="rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-white/40"
          >
            <option value="none">Balanced</option>
            <option value="run">Run</option>
            <option value="bike">Bike</option>
          </select>
        </label>

        <button
          onClick={onCoordinate}
          disabled={busy}
          className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-black transition hover:bg-white disabled:opacity-50"
        >
          {busy ? 'Coordinating…' : 'Coordinate'}
        </button>
      </div>

      {split && (split.run != null || split.bike != null) && (
        <p className="mt-3 text-xs text-white/70">
          Split:{' '}
          {split.run != null && <span>run {split.run} h</span>}
          {split.run != null && split.bike != null && ' · '}
          {split.bike != null && <span>bike {split.bike} h</span>}
          {' '}per week. Both plans rebuilt to fit.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
