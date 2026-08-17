'use client';

import { useState } from 'react';

/** Approve / decline a proposed (assisted-mode) adaptation. */
export function ProposalActions({ id }: { id: string }) {
  const [pending, setPending] = useState<null | 'approve' | 'decline'>(null);
  const [err, setErr] = useState(false);

  const act = async (action: 'approve' | 'decline') => {
    setPending(action);
    setErr(false);
    try {
      const res = await fetch(`/api/directives/${id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if ((await res.json())?.ok) {
        window.location.reload();
        return;
      }
      throw new Error();
    } catch {
      setErr(true);
      setPending(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!!pending}
        onClick={() => act('approve')}
        className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending === 'approve' ? '...' : 'Approve'}
      </button>
      <button
        type="button"
        disabled={!!pending}
        onClick={() => act('decline')}
        className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
      >
        {pending === 'decline' ? '...' : 'Decline'}
      </button>
      {err && <span className="text-xs text-rose-500">Failed</span>}
    </div>
  );
}
