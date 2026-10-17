'use client';
/**
 * Disconnect one provider. Asks once, then revokes our access at the provider
 * and forgets the tokens. Synced history stays.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DisconnectButton({ athleteId, provider, label }: { athleteId: string; provider: 'strava' | 'whoop' | 'garmin'; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function disconnect() {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/connections/${provider}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setErr('Could not disconnect. Try again.');
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-xs font-medium text-slate-500 underline transition hover:text-rose-300">
        Disconnect {label}
      </button>
    );
  }
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 text-xs text-slate-500">
      <p>
        Disconnect {label}? New data stops syncing and we delete our access tokens. Activities already synced stay in
        your history.
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={disconnect} disabled={pending} className="rounded-full bg-rose-500/90 px-3 py-1.5 font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50">
          {pending ? 'Disconnecting…' : 'Disconnect'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-full bg-white/[0.08] px-3 py-1.5 font-semibold text-white">
          Cancel
        </button>
      </div>
      {err && <p className="mt-2 text-rose-300">{err}</p>}
    </div>
  );
}
