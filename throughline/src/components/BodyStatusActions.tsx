'use client';
/**
 * The athlete's answers to a body-status question ("Are you feeling ill?"),
 * and the always-available "I'm feeling ill" report. Each answer rewrites the
 * plan on the server, then the page refreshes to show it.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Ask {
  action: string;
  label: string;
  primary?: boolean;
}

export function BodyStatusActions({ athleteId, question, asks, quiet = false }: { athleteId: string; question: string | null; asks: Ask[]; quiet?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!quiet);

  async function send(action: string) {
    setPending(action);
    setErr(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/body-status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Could not save that. Try again.');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that. Try again.');
    } finally {
      setPending(null);
    }
  }

  if (asks.length === 0) return null;

  // Quiet mode: a single low-key entry point that expands into the illness options.
  if (quiet && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-slate-500 underline transition hover:text-white">
        Feeling ill? Tell us
      </button>
    );
  }
  const options: Ask[] = quiet
    ? [
        { action: 'sick_mild', label: 'A cold (above the neck)' },
        { action: 'sick_systemic', label: 'Fever, chest, or body aches' },
        { action: 'tired', label: 'Not ill, just worn down' },
      ]
    : asks;

  return (
    <div>
      {(question || quiet) && <p className="text-sm font-semibold text-white">{question ?? 'How are you feeling?'}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((a) => (
          <button
            key={a.action}
            type="button"
            disabled={pending != null}
            onClick={() => send(a.action)}
            className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
              a.primary ? 'bg-lime-300 text-[#0a0a0b] hover:bg-lime-200' : 'bg-white/[0.08] text-white hover:bg-white/[0.14]'
            }`}
          >
            {pending === a.action ? 'Saving…' : a.label}
          </button>
        ))}
        {quiet && (
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 text-sm text-slate-500">
            Cancel
          </button>
        )}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-rose-300">{err}</p>}
    </div>
  );
}
