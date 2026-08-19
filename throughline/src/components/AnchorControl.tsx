'use client';

import { useState } from 'react';

export interface AnchorCandidate {
  day: string;
  name: string | null;
  distanceMeters: number;
  durationSeconds: number;
  distanceLabel: string;
  timeLabel: string;
  paceLabel: string;
  vdot: number;
}

const DISTANCES: { label: string; meters: number }[] = [
  { label: 'Mile', meters: 1609 },
  { label: '5K', meters: 5000 },
  { label: '10K', meters: 10000 },
  { label: '15K', meters: 15000 },
  { label: 'Half', meters: 21097 },
  { label: 'Marathon', meters: 42195 },
];

function parseTime(s: string): number | null {
  const parts = s.trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

/**
 * Set/confirm an athlete's fitness anchor. Suggestions come from their best
 * recent efforts (coach accepts one); or override manually with a race result,
 * threshold pace, or explicit VDOT.
 */
export function AnchorControl({
  athleteId,
  currentVdot,
  suggestions,
  source,
}: {
  athleteId: string;
  currentVdot: number | null;
  suggestions: AnchorCandidate[];
  source: 'auto' | 'manual' | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [mode, setMode] = useState<'race' | 'threshold' | 'vdot'>('race');
  const [raceMeters, setRaceMeters] = useState(5000);
  const [raceTime, setRaceTime] = useState('');
  const [thresholdPace, setThresholdPace] = useState(''); // min/mi
  const [vdotVal, setVdotVal] = useState('');

  async function post(body: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/anchor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ok) {
        setMsg(`Anchor set. VDOT ${j.vdot}${j.updatedSessions ? `, ${j.updatedSessions} sessions re-tuned` : ''}.`);
        setTimeout(() => window.location.reload(), 1000);
      } else setMsg(j.error ?? 'Failed.');
    } catch {
      setMsg('Network error.');
    } finally {
      setBusy(false);
    }
  }

  function submitManual() {
    if (mode === 'race') {
      const t = parseTime(raceTime);
      if (!t) return setMsg('Enter race time as mm:ss or h:mm:ss.');
      return post({ kind: 'race', distanceMeters: raceMeters, timeSeconds: t });
    }
    if (mode === 'threshold') {
      const t = parseTime(thresholdPace);
      if (!t) return setMsg('Enter threshold pace as mm:ss per mile.');
      return post({ kind: 'threshold', thresholdSecPerKm: t / 1.609344 });
    }
    const v = parseFloat(vdotVal);
    if (!Number.isFinite(v)) return setMsg('Enter a VDOT number.');
    return post({ kind: 'vdot', vdot: v });
  }

  const field = 'rounded border border-slate-300 px-2 py-1 text-sm';
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {currentVdot != null ? (
          source === 'auto' ? (
            <>
              <span className="font-medium text-slate-800">VDOT {currentVdot}</span>{' '}
              <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-400/30">
                auto
              </span>{' '}
             , inferred from the best recent effort, and refreshed as new data arrives. Confirm one
              below or override to lock it in.
            </>
          ) : (
            <>Current anchor: <span className="font-medium text-slate-800">VDOT {currentVdot}</span> (set by coach). Update it when this athlete races or hits a new benchmark.</>
          )
        ) : (
          <>No fitness anchor yet, paces and race predictions appear once one is set. {suggestions.length > 0 ? 'Pick a suggested effort below or enter one.' : 'Enter a recent race, threshold pace, or VDOT.'}</>
        )}
      </p>

      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Suggested from recent efforts
          </div>
          <ul className="space-y-1.5">
            {suggestions.map((c, i) => (
              <li key={`${c.day}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 text-slate-700">
                  <span className="font-medium">{c.distanceLabel}</span> · {c.timeLabel} · {c.paceLabel}
                  <span className="text-slate-400"> · {c.day}</span>
                  {c.name && <span className="ml-1 truncate text-xs text-slate-400">“{c.name}”</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                    VDOT {c.vdot}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => post({ kind: 'race', distanceMeters: c.distanceMeters, timeSeconds: c.durationSeconds })}
                    className="rounded bg-sky-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-50"
                  >
                    Use
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowManual((s) => !s)}
        className="text-xs font-medium text-sky-300 hover:underline"
      >
        {showManual ? 'Hide manual entry' : 'Enter manually / override →'}
      </button>

      {showManual && (
        <div className="space-y-2 rounded border border-slate-100 bg-slate-50 p-3">
          <div className="flex gap-3 text-xs">
            {(['race', 'threshold', 'vdot'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1 text-slate-600">
                <input type="radio" name="anchorMode" checked={mode === m} onChange={() => setMode(m)} />
                {m === 'race' ? 'Race result' : m === 'threshold' ? 'Threshold pace' : 'VDOT'}
              </label>
            ))}
          </div>
          {mode === 'race' && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">
                Distance
                <select value={raceMeters} onChange={(e) => setRaceMeters(Number(e.target.value))} className={`block ${field}`}>
                  {DISTANCES.map((d) => (
                    <option key={d.label} value={d.meters}>{d.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Time (mm:ss)
                <input value={raceTime} onChange={(e) => setRaceTime(e.target.value)} placeholder="19:45" className={`block ${field}`} />
              </label>
            </div>
          )}
          {mode === 'threshold' && (
            <label className="text-xs text-slate-600">
              Threshold pace (min/mi)
              <input value={thresholdPace} onChange={(e) => setThresholdPace(e.target.value)} placeholder="6:40" className={`block ${field}`} />
            </label>
          )}
          {mode === 'vdot' && (
            <label className="text-xs text-slate-600">
              VDOT
              <input value={vdotVal} onChange={(e) => setVdotVal(e.target.value)} placeholder="52" className={`block ${field}`} />
            </label>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={submitManual}
            className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Set anchor'}
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
