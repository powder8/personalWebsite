'use client';

import { useState } from 'react';

export function EscalationActions({ id, status }: { id: string; status: string }) {
  const [pending, setPending] = useState(false);

  async function set(next: 'acknowledged' | 'resolved') {
    setPending(true);
    try {
      await fetch(`/api/escalations/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      window.location.reload();
    } catch {
      setPending(false);
    }
  }

  const btn = 'rounded px-2 py-1 text-xs font-medium disabled:opacity-50';
  return (
    <div className="flex gap-2">
      {status === 'open' && (
        <button
          onClick={() => set('acknowledged')}
          disabled={pending}
          className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}
        >
          Acknowledge
        </button>
      )}
      <button
        onClick={() => set('resolved')}
        disabled={pending}
        className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
      >
        Resolve
      </button>
    </div>
  );
}
