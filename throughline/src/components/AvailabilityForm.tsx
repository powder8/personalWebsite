'use client';

import { useState } from 'react';

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
    if (!from) {
      setErr('Pick a start date.');
      setPending(false);
      return;
    }
    try {
      const res = await fetch(`/api/athletes/${athleteId}/directives`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'unavailable', from, to, label: String(fd.get('reason') || '') }),
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
          Reason
          <input name="reason" placeholder="Out of town / busy / sick" className={`block w-full ${field}`} />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Saving…' : "Mark these days I can't train"}
      </button>
      {done && <p className="text-sm text-emerald-700">Got it — those days will show as rest. 🙌</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </form>
  );
}
