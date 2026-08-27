'use client';

import { useState } from 'react';

/**
 * Quick cycling-FTP update. Cyclists get fitter between tests, and an estimated
 * starter FTP needs sharpening — this bumps the anchor and re-tunes future rides
 * on the spot, no full plan rebuild. The server (setAthleteFtp) reports how many
 * rides it re-tuned.
 */
export function FtpUpdate({ athleteId, currentFtp }: { athleteId: string; currentFtp: number }) {
  const [ftp, setFtp] = useState(String(currentFtp));
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setMsg(null);
    const w = Number(ftp);
    if (!(w > 0) || w > 600) {
      setErr('Enter your FTP in watts (up to 600).');
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/ftp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ftpWatts: w }),
      });
      const j = await res.json();
      if (j.ok) {
        setMsg(
          j.updatedSessions > 0
            ? `Updated to ${j.ftpWatts} W. Re-tuned ${j.updatedSessions} upcoming ride${j.updatedSessions === 1 ? '' : 's'}.`
            : `Updated to ${j.ftpWatts} W.`,
        );
      } else {
        setErr(j.error ?? 'Failed.');
      }
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        Getting fitter or working from an estimate? Update your FTP and I&apos;ll re-tune your upcoming rides.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={60}
          max={600}
          value={ftp}
          onChange={(e) => {
            setFtp(e.target.value);
            setMsg(null);
          }}
          className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
          aria-label="FTP in watts"
        />
        <span className="text-sm text-slate-500">W</span>
        <button
          onClick={save}
          disabled={pending || ftp === String(currentFtp)}
          className="rounded-full bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Update FTP'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-emerald-600">{msg}</p>}
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
