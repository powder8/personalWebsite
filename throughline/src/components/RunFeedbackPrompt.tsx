'use client';
/**
 * "How did it feel?" — the athlete's own post-run read, for what the sensors
 * can't see (felt off, took breaks, surface). Saves to the run, then reloads so
 * the debrief above incorporates it. Pre-filled if already answered.
 */
import { useState } from 'react';
import type { RunFeedbackInput } from '@/server/runDebrief';

type Feel = 'strong' | 'fine' | 'rough';
type Surface = 'road' | 'trail' | 'track' | 'treadmill';

const FEELS: { v: Feel; emoji: string; label: string }[] = [
  { v: 'strong', emoji: '💚', label: 'Strong' },
  { v: 'fine', emoji: '🙂', label: 'Fine' },
  { v: 'rough', emoji: '😮‍💨', label: 'Rough' },
];
const SURFACES: Surface[] = ['road', 'trail', 'track', 'treadmill'];

export function RunFeedbackPrompt({
  athleteId,
  activityId,
  existing,
}: {
  athleteId: string;
  activityId: string;
  existing: RunFeedbackInput | null;
}) {
  const [feel, setFeel] = useState<Feel | null>((existing?.feel as Feel) ?? null);
  const [tookBreaks, setTookBreaks] = useState<boolean>(existing?.tookBreaks ?? false);
  const [unwell, setUnwell] = useState<boolean>(existing?.unwell ?? false);
  const [surface, setSurface] = useState<Surface | null>((existing?.surface as Surface) ?? null);
  const [note, setNote] = useState<string>(existing?.note ?? '');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/runs/${activityId}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feel, tookBreaks, unwell, surface, note }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save.');
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
      setPending(false);
    }
  }

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
      active ? 'bg-lime-300 text-[#0c1018] ring-lime-300' : 'bg-slate-800 text-slate-300 ring-slate-600 hover:bg-slate-700'
    }`;

  return (
    <div className="rounded-2xl bg-[#11151f] p-4 ring-1 ring-inset ring-slate-700/50">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {existing ? 'Your note to your coach' : 'How did it feel?'}
      </div>
      <p className="mt-1 text-xs text-slate-400">Tell your coach what the data can’t see — it shapes the debrief above.</p>

      <div className="mt-3 flex gap-2">
        {FEELS.map((f) => (
          <button key={f.v} onClick={() => setFeel(feel === f.v ? null : f.v)} className={chip(feel === f.v)}>
            {f.emoji} {f.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => setTookBreaks(!tookBreaks)} className={chip(tookBreaks)}>Took breaks</button>
        <button onClick={() => setUnwell(!unwell)} className={chip(unwell)}>Felt unwell</button>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Surface</div>
        <div className="flex flex-wrap gap-2">
          {SURFACES.map((s) => (
            <button key={s} onClick={() => setSurface(surface === s ? null : s)} className={chip(surface === s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else? (optional)"
        rows={2}
        className="mt-3 w-full rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 ring-1 ring-inset ring-slate-600 focus:outline-none focus:ring-lime-400/40"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-full bg-lime-300 px-4 py-2 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200 disabled:opacity-50"
        >
          {pending ? 'Saving…' : existing ? 'Update' : 'Send to coach'}
        </button>
        {err && <span className="text-xs text-rose-400">{err}</span>}
      </div>
    </div>
  );
}
