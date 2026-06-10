'use client';

import { useState } from 'react';

/**
 * Set an athlete's date of birth — for future age-grading (comparing
 * performances fairly across a career). It does not change paces on its own.
 * Coach-facing, on the athlete detail page.
 */
export function DobControl({ athleteId, initial }: { athleteId: string; initial: string | null }) {
  const [value, setValue] = useState(initial ?? '');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dateOfBirth: value || null }),
      });
      const json = await res.json();
      if (json.ok) {
        setSaved(true);
        setTimeout(() => window.location.reload(), 700);
      } else setErr(json.error ?? 'Failed.');
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-600">
        Date of birth
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-0.5 block rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <button
        onClick={save}
        disabled={pending}
        className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {saved && <span className="text-sm text-emerald-300">Saved ✓</span>}
      {err && <span className="text-sm text-rose-600">{err}</span>}
    </div>
  );
}
