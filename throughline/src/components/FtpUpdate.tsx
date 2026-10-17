'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FtpProvenance } from '@/server/autoFtp';

/**
 * Quick cycling-FTP update. Cyclists get fitter between tests, and an estimated
 * starter FTP needs sharpening — this bumps the anchor and re-tunes future rides
 * on the spot, no full plan rebuild. The server (setAthleteFtp) reports how many
 * rides it re-tuned.
 */
const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function FtpUpdate({
  athleteId,
  currentFtp,
  provenance,
}: {
  athleteId: string;
  currentFtp: number;
  provenance?: FtpProvenance;
}) {
  const router = useRouter();
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
        router.refresh();
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

  async function trackFromRides() {
    setErr(null);
    setMsg(null);
    setPending(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/ftp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      });
      const j = await res.json();
      if (!j.ok) {
        setErr(j.error ?? 'Failed.');
        return;
      }
      if (j.ftpWatts) setFtp(String(j.ftpWatts));
      setMsg(
        j.status === 'updated'
          ? `Set to ${j.ftpWatts} W from your rides. Re-tuned ${j.updatedSessions} upcoming ride${j.updatedSessions === 1 ? '' : 's'}.`
          : 'Your rides will set your FTP from your next synced ride with power.',
      );
      router.refresh();
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  const origin = provenance?.origin;
  return (
    <div>
      {/* Where the number comes from, so a gap with Garmin's FTP is explainable. */}
      <p className="mb-2 text-xs text-slate-500">
        {origin === 'starter' ? (
          <>
            This is a starting estimate from your body weight. It updates on its own after you sync a ride with a power
            meter. You can also enter your FTP from Garmin.
          </>
        ) : origin === 'rides' ? (
          <>
            Set from your rides
            {provenance?.estimate ? ` on ${fmtDay(provenance.estimate.on)} (${provenance.estimate.sampleSize} ride${provenance.estimate.sampleSize === 1 ? '' : 's'} with power)` : ''}
            : best 20-minute power × 0.95 over the last 4 months. It keeps updating as you ride. Entering a number pins it.
          </>
        ) : (
          <>You entered this FTP, so it stays fixed. Update it after a test, or let your rides set it.</>
        )}
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
          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#0a0a0b] transition hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Update FTP'}
        </button>
      </div>
      {origin === 'manual' && (
        <button
          type="button"
          onClick={trackFromRides}
          disabled={pending}
          className="mt-2 text-xs font-semibold text-sky-300 underline disabled:opacity-50"
        >
          Let my rides set my FTP
        </button>
      )}
      {msg && <p className="mt-2 text-xs font-medium text-emerald-600">{msg}</p>}
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
