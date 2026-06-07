'use client';

import { useState } from 'react';

export function FeedbackActions({ id, status }: { id: string; status: string }) {
  const [pending, setPending] = useState(false);
  async function set(next: 'open' | 'addressed') {
    setPending(true);
    try {
      await fetch(`/api/feedback/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      window.location.reload();
    } catch {
      setPending(false);
    }
  }
  return status === 'open' ? (
    <button
      onClick={() => set('addressed')}
      disabled={pending}
      className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      Mark addressed
    </button>
  ) : (
    <button
      onClick={() => set('open')}
      disabled={pending}
      className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
    >
      Reopen
    </button>
  );
}
