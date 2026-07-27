'use client';

import { useState } from 'react';

/**
 * Autonomous-mode readiness gate UI. When wearable markers read low on a
 * quality day, we ASK the athlete how they feel before easing anything —
 * their answer is written as a normal check-in (so it re-fuses into the
 * readiness engine) and the page reloads to show the resolved recommendation
 * (ease vs keep). Only the 'ask' state is interactive; 'ease' / 'hold' are
 * rendered server-side by the portal.
 */
const OPTIONS: { key: string; label: string; emoji: string; energy: number; soreness: number }[] = [
  { key: 'rough', label: 'Rough — feeling it', emoji: '🥵', energy: 2, soreness: 7 },
  { key: 'off', label: 'A bit off', emoji: '😕', energy: 4, soreness: 5 },
  { key: 'good', label: 'Actually good', emoji: '💪', energy: 8, soreness: 1 },
];

export function ReadinessCheck({
  athleteId,
  day,
  title,
  body,
}: {
  athleteId: string;
  day: string;
  title: string;
  body: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function answer(opt: (typeof OPTIONS)[number]) {
    setPending(opt.key);
    setErr(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, energy: opt.energy, soreness: opt.soreness }),
      });
      const json = await res.json();
      if (json.ok) window.location.reload();
      else {
        setErr(json.error ?? 'Failed to save.');
        setPending(null);
      }
    } catch {
      setErr('Network error — try again.');
      setPending(null);
    }
  }

  return (
    <div className="rounded-3xl bg-gradient-to-br from-amber-500/20 via-[#10141f] to-[#0c0f17] p-5 shadow-lg ring-1 ring-inset ring-amber-400/30">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">A quick gut check</div>
      <h2 className="mt-1 flex items-center gap-2 text-lg font-bold tracking-tight text-white">
        <span aria-hidden>🫀</span>
        <span>{title}</span>
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-white/80">{body}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            disabled={pending != null}
            onClick={() => answer(opt)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
          >
            <span aria-hidden>{opt.emoji}</span>
            <span>{pending === opt.key ? 'Saving…' : opt.label}</span>
          </button>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
    </div>
  );
}
