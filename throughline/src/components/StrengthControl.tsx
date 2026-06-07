'use client';

import { useState } from 'react';

const OPTIONS: { label: string; value: number }[] = [
  { label: 'Endurance type (−)', value: -0.6 },
  { label: 'Slightly endurance', value: -0.3 },
  { label: 'Balanced', value: 0 },
  { label: 'Slightly speed', value: 0.3 },
  { label: 'Speed type (+)', value: 0.6 },
];

function nearest(bias: number): number {
  return OPTIONS.reduce((a, b) => (Math.abs(b.value - bias) < Math.abs(a.value - bias) ? b : a)).value;
}

export function StrengthControl({ athleteId, bias }: { athleteId: string; bias: number }) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = Number(e.target.value);
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/strength`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bias: value }),
      });
      const json = await res.json();
      if (json.ok) window.location.reload();
      else {
        setMsg(json.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setMsg('Network error.');
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Strength profile</span>
      <select
        defaultValue={nearest(bias)}
        onChange={onChange}
        disabled={pending}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-slate-400">speed = faster reps, slower marathon</span>
      {msg && <span className="text-xs text-rose-600">{msg}</span>}
    </div>
  );
}
