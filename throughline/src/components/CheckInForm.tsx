'use client';

import { useState } from 'react';

/**
 * Athlete daily check-in. Three 0–10 sliders + an optional note. These are the
 * subjective inputs the readiness engine fuses with HRV/sleep/resting-HR.
 */
export function CheckInForm({
  athleteId,
  day,
  initial,
}: {
  athleteId: string;
  day: string;
  initial?: { soreness: number | null; energy: number | null; yesterdayRpe: number | null } | null;
}) {
  const [soreness, setSoreness] = useState(initial?.soreness ?? 2);
  const [energy, setEnergy] = useState(initial?.energy ?? 6);
  const [rpe, setRpe] = useState(initial?.yesterdayRpe ?? 5);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, soreness, energy, yesterdayRpe: rpe, note }),
      });
      const json = await res.json();
      if (json.ok) {
        setDone(true);
        setTimeout(() => window.location.reload(), 800);
      } else setErr(json.error ?? 'Failed.');
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Slider label="Soreness" hint="0 = none · 10 = very sore" value={soreness} onChange={setSoreness} />
      <Slider label="Energy" hint="0 = drained · 10 = great" value={energy} onChange={setEnergy} />
      <Slider label="Yesterday's effort (RPE)" hint="0 = rest · 10 = max" value={rpe} onChange={setRpe} />
      <label className="block text-xs text-slate-600">
        Note (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything your coach should know?"
          className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Saving...' : initial ? 'Update check-in' : 'Submit check-in'}
      </button>
      {done && <p className="text-sm text-emerald-300">Thanks, logged for today. 🙌</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </form>
  );
}

function Slider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        <span className="text-sm tabular-nums text-slate-900">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-sky-700"
      />
      <span className="text-[11px] text-slate-400">{hint}</span>
    </label>
  );
}
