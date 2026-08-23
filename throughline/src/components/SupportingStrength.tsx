'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Supporting-strength cadence: 0–4 sessions/week laid over the plan as a
 * durability layer (no race goal, no anchor). Saves and rebuilds the strength
 * sessions, then refreshes so they appear in the calendar.
 */
const OPTIONS = [0, 1, 2, 3, 4];

export function SupportingStrength({ athleteId, current }: { athleteId: string; current: number }) {
  const router = useRouter();
  const [days, setDays] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(next: number) {
    setDays(next);
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/strength-plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ daysPerWeek: next }),
      });
      const data = await res.json().catch(() => ({ error: 'Bad response.' }));
      if (!res.ok) {
        setMsg(data.error ?? 'Could not update strength.');
        return;
      }
      setMsg(next === 0 ? 'Strength removed from your week.' : `${next}× strength/week added across ${data.weeks} weeks.`);
      router.refresh();
    } catch {
      setMsg('Network error, try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-slate-400">
        💪 Strength supports your endurance training — durability and injury resistance. Pick how many sessions a week
        and they&apos;ll appear in your calendar alongside your runs and rides.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            onClick={() => save(n)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition disabled:opacity-50 ${
              days === n
                ? 'bg-lime-300/20 text-lime-200 ring-lime-400/40'
                : 'bg-white/5 text-slate-300 ring-white/10 hover:text-white'
            }`}
          >
            {n === 0 ? 'None' : `${n}×/wk`}
          </button>
        ))}
      </div>
      {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
