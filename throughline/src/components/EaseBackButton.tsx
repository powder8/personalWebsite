'use client';

import { useState } from 'react';

interface DirectivePayload {
  type: 'reduce_volume' | 'pace_adjust';
  from: string;
  to: string;
  factor?: number;
  deltaSecPerMile?: number;
  label: string;
}

/**
 * One tap to ease back in after a layoff: posts windowed reduce_volume (+ pace)
 * directives. The engine overlays them onto upcoming days IN PLACE — no dates
 * move. Coach-reviewable like any other directive; removable anytime.
 */
export function EaseBackButton({ athleteId, directives }: { athleteId: string; directives: DirectivePayload[] }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setErr(null);
    try {
      for (const d of directives) {
        const res = await fetch(`/api/athletes/${athleteId}/directives`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(d),
        });
        const j = await res.json();
        if (!j.ok) {
          setErr(j.error ?? 'Failed.');
          setPending(false);
          return;
        }
      }
      setDone(true);
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  if (done) return <p className="text-sm font-medium text-lime-300">Done, your next few days are eased. Go get the first one. 💪</p>;

  return (
    <div>
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-lg bg-lime-300 px-4 py-2 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200 disabled:opacity-50"
      >
        {pending ? 'Easing you back in...' : 'Ease me back in'}
      </button>
      {err && <p className="mt-1 text-xs text-rose-300">{err}</p>}
    </div>
  );
}
