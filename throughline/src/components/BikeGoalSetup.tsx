'use client';

import { useState } from 'react';

/** "22" → 22:00, "1:45:00" → h:m:s, "1.45.00"/"1 45 00" → same. */
function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(/[:.\s]+/).map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const field = 'w-full rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-lime-400/40';
const label = 'block text-xs font-medium text-slate-400 mb-1';

/**
 * Athlete-facing standalone cycling onboarding. Sets FTP (+ weight) and a goal
 * event, builds a published bike-only plan.
 */
export function BikeGoalSetup({
  athleteId,
  defaultDob,
  defaultWeightKg,
  defaultFtp,
}: {
  athleteId: string;
  defaultDob?: string | null;
  defaultWeightKg?: number | null;
  defaultFtp?: number | null;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const ftp = Number(fd.get('ftp') || 0);
    if (!(ftp > 0)) return setErr('Enter your cycling FTP in watts.');
    const targetRaw = String(fd.get('targetTime') || '').trim();
    const targetTimeSeconds = targetRaw ? parseClock(targetRaw) ?? undefined : undefined;
    const distKm = Number(fd.get('distanceKm') || 0);
    if (targetTimeSeconds && !(distKm > 0)) {
      return setErr('Add the race distance so a target time means something.');
    }

    const body = {
      eventName: String(fd.get('eventName') || '') || undefined,
      date: String(fd.get('date') || ''),
      distanceMeters: distKm > 0 ? distKm * 1000 : undefined,
      elevationGainMeters: Number(fd.get('elevationM') || 0) || undefined,
      targetTimeSeconds,
      weeklyHours: Number(fd.get('weeklyHours') || 0),
      ftpWatts: ftp,
      weightKg: Number(fd.get('weightKg') || 0) || undefined,
      targetFtpWatts: Number(fd.get('targetFtp') || 0) || undefined,
      dateOfBirth: String(fd.get('dob') || '') || undefined,
    };

    setPending(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/bike-goal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ok) {
        setDone(true);
        setPending(false);
      } else {
        setErr(j.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-400/10 p-4 ring-1 ring-inset ring-emerald-400/30">
          <h3 className="text-lg font-bold text-white">Your cycling plan is ready 🚴</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-white/85">
            Built and live — periodized power sessions ramping to your event. Head to your plan to see this week.
          </p>
        </div>
        <a
          href={`/me/${athleteId}`}
          className="inline-block rounded-full bg-lime-300 px-4 py-2 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200"
        >
          Go to my plan →
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Goal event (optional)</label>
          <input name="eventName" placeholder="Gran fondo, TT, FTP block…" className={field} />
        </div>
        <div>
          <label className={label}>Event / target date</label>
          <input type="date" name="date" required className={field} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Training hours / week</label>
          <input type="number" name="weeklyHours" min="1" max="25" step="0.5" defaultValue="6" required className={field} />
        </div>
        <div>
          <label className={label}>Goal FTP — watts (optional)</label>
          <input type="number" name="targetFtp" min="60" max="500" placeholder="265" className={field} />
        </div>
      </div>

      {/* Race goal — distance + climbing make a target time mean something. */}
      <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your race (optional)</div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Distance (km)</label>
            <input type="number" name="distanceKm" min="5" max="400" step="1" placeholder="160" className={field} />
          </div>
          <div>
            <label className={label}>Climbing (m)</label>
            <input type="number" name="elevationM" min="0" max="8000" step="10" placeholder="1850" className={field} />
          </div>
          <div>
            <label className={label}>Target time</label>
            <input name="targetTime" placeholder="5:30:00" className={field} />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          From the race page — distance &amp; total elevation. I&apos;ll tell you honestly whether your target time is on.
        </p>
      </div>

      <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your cycling fitness</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={label}>🚴 FTP (watts)</label>
            <input type="number" name="ftp" min="60" max="500" defaultValue={defaultFtp ?? undefined} placeholder="240" required className={field} />
          </div>
          <div>
            <label className={label}>Body weight (kg)</label>
            <input type="number" name="weightKg" min="35" max="160" step="0.5" defaultValue={defaultWeightKg ?? undefined} placeholder="74" className={field} />
          </div>
        </div>
        <div className="mt-3">
          <label className={label}>Date of birth</label>
          <input type="date" name="dob" defaultValue={defaultDob ?? undefined} className={field} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          FTP is your ~1-hour max power — from a ramp test, a 20-min test (× 0.95), or your head unit&apos;s estimate.
        </p>
      </div>

      {err && <p className="text-sm text-rose-300">{err}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200 disabled:opacity-50"
      >
        {pending ? 'Building your plan…' : 'Build my cycling plan'}
      </button>
    </form>
  );
}
