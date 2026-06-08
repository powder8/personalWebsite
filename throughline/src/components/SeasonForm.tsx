'use client';

import { useState } from 'react';
import { RACE_PURPOSES } from '@/engine/plan/racePurpose';

const DISTANCES: { label: string; meters: number }[] = [
  { label: 'Mile', meters: 1609.34 },
  { label: '3K', meters: 3000 },
  { label: '5K', meters: 5000 },
  { label: '10K', meters: 10000 },
  { label: '15K', meters: 15000 },
  { label: 'Half', meters: 21097.5 },
  { label: 'Marathon', meters: 42195 },
];

/** "mm:ss" or "h:mm:ss" → seconds. Returns null if blank/invalid. */
function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const metersFor = (label: string) => DISTANCES.find((d) => d.label === label)?.meters;

interface KeyRaceRow {
  name: string;
  date: string;
  distanceLabel: string;
  purpose: string;
}

const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm';

export function SeasonForm({ athleteId }: { athleteId: string }) {
  const [keyRaces, setKeyRaces] = useState<KeyRaceRow[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; weeks?: number; error?: string } | null>(null);

  function addRow() {
    setKeyRaces((r) => [...r, { name: '', date: '', distanceLabel: '10K', purpose: 'tune_up' }]);
  }
  function updateRow(i: number, patch: Partial<KeyRaceRow>) {
    setKeyRaces((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }
  function removeRow(i: number) {
    setKeyRaces((r) => r.filter((_, j) => j !== i));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const goalDist = String(fd.get('goalDistance'));
    const fitDist = String(fd.get('fitnessDistance'));

    const body = {
      goalRace: {
        name: String(fd.get('goalName') || ''),
        date: String(fd.get('goalDate') || ''),
        distanceLabel: goalDist,
        distanceMeters: metersFor(goalDist),
        goalType: 'time' as const,
        targetTimeSeconds: parseClock(String(fd.get('goalTime') || '')) ?? undefined,
      },
      fitness: {
        race: {
          distanceMeters: metersFor(fitDist)!,
          timeSeconds: parseClock(String(fd.get('fitnessTime') || '')) ?? 0,
        },
      },
      startVolumeMiles: Number(fd.get('startVol') || 30),
      peakVolumeMiles: Number(fd.get('peakVol') || 50),
      keyRaces: keyRaces
        .filter((r) => r.name && r.date)
        .map((r) => ({
          name: r.name,
          date: r.date,
          distanceLabel: r.distanceLabel,
          distanceMeters: metersFor(r.distanceLabel),
          purpose: r.purpose,
        })),
    };

    try {
      const res = await fetch(`/api/athletes/${athleteId}/season`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setResult(json);
      if (json.ok) setTimeout(() => window.location.reload(), 600);
    } catch {
      setResult({ error: 'Network error.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-700">Goal race</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="col-span-2 block">
            <span className="text-xs text-slate-600">Name</span>
            <input name="goalName" required placeholder="CIM Marathon" className={field} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Date</span>
            <input name="goalDate" type="date" required className={field} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Distance</span>
            <select name="goalDistance" defaultValue="Marathon" className={field}>
              {DISTANCES.map((d) => (
                <option key={d.label}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Goal time (h:mm:ss)</span>
            <input name="goalTime" placeholder="2:38:00" className={field} />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-700">Fitness anchor (recent race)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs text-slate-600">Distance</span>
            <select name="fitnessDistance" defaultValue="Half" className={field}>
              {DISTANCES.map((d) => (
                <option key={d.label}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Time (h:mm:ss)</span>
            <input name="fitnessTime" required placeholder="1:13:00" className={field} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Start vol (mi/wk)</span>
            <input name="startVol" type="number" defaultValue={50} className={field} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Peak vol (mi/wk)</span>
            <input name="peakVol" type="number" defaultValue={70} className={field} />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-semibold text-slate-700">Key races (optional)</legend>
          <button type="button" onClick={addRow} className="text-xs font-medium text-sky-700 hover:underline">
            + Add race
          </button>
        </div>
        {keyRaces.map((r, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            <label className="col-span-4">
              <span className="text-xs text-slate-600">Name</span>
              <input
                value={r.name}
                onChange={(e) => updateRow(i, { name: e.target.value })}
                placeholder="Turkey Trot 10K"
                className={field}
              />
            </label>
            <label className="col-span-3">
              <span className="text-xs text-slate-600">Date</span>
              <input type="date" value={r.date} onChange={(e) => updateRow(i, { date: e.target.value })} className={field} />
            </label>
            <label className="col-span-2">
              <span className="text-xs text-slate-600">Dist</span>
              <select value={r.distanceLabel} onChange={(e) => updateRow(i, { distanceLabel: e.target.value })} className={field}>
                {DISTANCES.map((d) => (
                  <option key={d.label}>{d.label}</option>
                ))}
              </select>
            </label>
            <label className="col-span-2">
              <span className="text-xs text-slate-600">Purpose</span>
              <select
                value={r.purpose}
                onChange={(e) => updateRow(i, { purpose: e.target.value })}
                className={field}
              >
                {RACE_PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => removeRow(i)} className="col-span-1 pb-2 text-xs text-rose-600">
              ✕
            </button>
          </div>
        ))}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Generating…' : 'Generate plan'}
      </button>

      {result?.error && (
        <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
          Generated a {result.weeks}-week plan. Refreshing…
        </p>
      )}
    </form>
  );
}
