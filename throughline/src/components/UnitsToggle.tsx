'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Units } from '@/lib/units';

/** Distance/pace unit preference (miles or kilometers), applied across the app. */
export function UnitsToggle({ athleteId, current }: { athleteId: string; current: Units }) {
  const router = useRouter();
  const [units, setUnits] = useState<Units>(current);
  const [busy, setBusy] = useState(false);

  async function save(next: Units) {
    if (next === units) return;
    setUnits(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/units`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ units: next }),
      });
      if (res.ok) router.refresh();
      else setUnits(current);
    } catch {
      setUnits(current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-slate-400">Distances and paces show in your chosen unit across the whole app.</p>
      <div className="inline-flex rounded-lg ring-1 ring-inset ring-white/15">
        {(['mi', 'km'] as const).map((u) => (
          <button
            key={u}
            type="button"
            disabled={busy}
            onClick={() => save(u)}
            className={`px-4 py-1.5 text-sm font-medium transition first:rounded-l-lg last:rounded-r-lg disabled:opacity-50 ${
              units === u ? 'bg-lime-300/20 text-lime-200' : 'text-slate-300 hover:text-white'
            }`}
          >
            {u === 'mi' ? 'Miles' : 'Kilometers'}
          </button>
        ))}
      </div>
    </div>
  );
}
