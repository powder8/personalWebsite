'use client';
/**
 * Fitness-grounding banner for the race plan: shows how the prescribed targets
 * square with the athlete's actual recent running, and (when they're out of
 * step) offers to re-anchor to a demonstrated effort. Re-anchoring re-tunes
 * future planned paces server-side, so a reload reflects the new targets.
 */
import { useState } from 'react';
import type { Grounding } from '@/server/fitnessGrounding';

const TONE: Record<Grounding['status'], { ring: string; bg: string; dot: string; label: string }> = {
  optimistic: { ring: 'ring-amber-400/30', bg: 'bg-amber-400/10', dot: 'bg-amber-400', label: 'text-amber-300' },
  conservative: { ring: 'ring-sky-400/30', bg: 'bg-sky-400/10', dot: 'bg-sky-400', label: 'text-sky-300' },
  no_data: { ring: 'ring-slate-400/30', bg: 'bg-slate-400/10', dot: 'bg-slate-400', label: 'text-slate-400' },
  confirmed: { ring: 'ring-emerald-400/30', bg: 'bg-emerald-400/10', dot: 'bg-emerald-400', label: 'text-emerald-300' },
};

export function GroundingNotice({
  athleteId,
  grounding,
  offer,
}: {
  athleteId: string;
  grounding: Grounding;
  offer: { distanceMeters: number; timeSeconds: number; label: string } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tone = TONE[grounding.status];

  async function reAnchor() {
    if (!offer) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/anchor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'race', distanceMeters: offer.distanceMeters, timeSeconds: offer.timeSeconds }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not update.');
      setDone(true);
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update.');
      setBusy(false);
    }
  }

  return (
    <div className={`mt-3 rounded-2xl ${tone.bg} p-3 ring-1 ring-inset ${tone.ring}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${tone.label}`}>{grounding.headline}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{grounding.note}</p>
      {grounding.offerRecentAnchor && offer && (
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={reAnchor}
            disabled={busy || done}
            className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Updating...' : `Use my ${offer.label} (VDOT ${grounding.demonstrated?.vdot})`}
          </button>
          <span className="text-[11px] text-slate-400">Re-tunes your training paces. Your coach can change it back.</span>
        </div>
      )}
      {err && <p className="mt-1 text-[11px] text-rose-400">{err}</p>}
    </div>
  );
}
