'use client';

import { useState } from 'react';

export interface EditableSession {
  id: string;
  day: string;
  sessionType: string;
  targetDistanceMeters: number | null;
  targetPaceFastSecPerKm: number | null;
  targetPaceSlowSecPerKm: number | null;
  description: string | null;
  pinned: boolean;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SESSION_TYPES = [
  'recovery',
  'easy',
  'maintenance',
  'marathon',
  'long',
  'tempo',
  'threshold',
  'intervals',
  'race',
  'rest',
  'cross_train',
];
const REASONS: [string, string][] = [
  ['too_aggressive', 'Too aggressive'],
  ['too_cautious', 'Too cautious'],
  ['injury_judgment', 'Injury judgment'],
  ['life_stress', 'Life stress'],
  ['travel', 'Travel'],
  ['weather', 'Weather'],
  ['race_strategy', 'Race strategy'],
  ['athlete_request', 'Athlete request'],
  ['data_quality', 'Data quality'],
  ['other', 'Other'],
];

function dow(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return DOW[((Math.floor(Date.UTC(y, m - 1, d) / 86400000) % 7) + 3) % 7];
}
function miles(m: number | null): string {
  return m == null ? '' : (m / 1609.344).toFixed(1);
}
function paceMinMile(secPerKm: number | null): string {
  if (secPerKm == null) return '';
  const secPerMile = secPerKm * 1.609344;
  const mm = Math.floor(secPerMile / 60);
  const ss = Math.round(secPerMile - mm * 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}
function parseMinMile(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const [mm, ss] = t.split(':').map(Number);
  if (Number.isNaN(mm)) return undefined;
  return mm * 60 + (ss || 0); // sec per mile
}

export function SessionEditor({ session, today }: { session: EditableSession; today: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const field = 'rounded border border-slate-300 px-2 py-1 text-sm';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const edits = {
      distanceMiles: fd.get('distance') ? Number(fd.get('distance')) : undefined,
      sessionType: (fd.get('sessionType') as string) || undefined,
      description: (fd.get('description') as string) ?? undefined,
      paceFastSecPerMile: parseMinMile(String(fd.get('paceFast') || '')),
      paceSlowSecPerMile: parseMinMile(String(fd.get('paceSlow') || '')),
    };
    const body = { edits, reasonCode: fd.get('reason'), note: String(fd.get('note') || '') };
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) window.location.reload();
      else {
        setErr(json.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  return (
    <>
      <tr className={session.day === today ? 'bg-sky-400/10' : ''}>
        <td className="w-12 px-2 py-1.5 font-medium text-slate-500">{dow(session.day)}</td>
        <td className="w-16 px-2 py-1.5 text-slate-700">
          {session.targetDistanceMeters ? `${miles(session.targetDistanceMeters)} mi` : '-'}
        </td>
        <td className="px-2 py-1.5">
          <span className="capitalize text-slate-800">{session.sessionType}</span>
          {session.targetPaceFastSecPerKm != null && (
            <span className="ml-2 text-xs text-slate-400">
              {paceMinMile(session.targetPaceFastSecPerKm)}-{paceMinMile(session.targetPaceSlowSecPerKm)}/mi
            </span>
          )}
          {session.pinned && (
            <span className="ml-2 rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600">pinned</span>
          )}
          {session.description && <p className="text-xs text-slate-500">{session.description}</p>}
        </td>
        <td className="w-12 px-2 py-1.5 text-right">
          <button onClick={() => setEditing((v) => !v)} className="text-xs text-sky-300 hover:underline">
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={4} className="bg-slate-50 px-3 py-3">
            <form onSubmit={onSubmit} className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="text-xs text-slate-600">
                  Distance (mi)
                  <input name="distance" type="number" step="0.1" defaultValue={miles(session.targetDistanceMeters)} className={`mt-0.5 w-full ${field}`} />
                </label>
                <label className="text-xs text-slate-600">
                  Type
                  <select name="sessionType" defaultValue={session.sessionType} className={`mt-0.5 w-full ${field}`}>
                    {SESSION_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  Pace fast (m:ss/mi)
                  <input name="paceFast" defaultValue={paceMinMile(session.targetPaceFastSecPerKm)} placeholder="-" className={`mt-0.5 w-full ${field}`} />
                </label>
                <label className="text-xs text-slate-600">
                  Pace slow (m:ss/mi)
                  <input name="paceSlow" defaultValue={paceMinMile(session.targetPaceSlowSecPerKm)} placeholder="-" className={`mt-0.5 w-full ${field}`} />
                </label>
              </div>
              <label className="block text-xs text-slate-600">
                Description
                <input name="description" defaultValue={session.description ?? ''} className={`mt-0.5 w-full ${field}`} />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-600">
                  Reason (required)
                  <select name="reason" required defaultValue="" className={`mt-0.5 block ${field}`}>
                    <option value="" disabled>
                      Select...
                    </option>
                    {REASONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex-1 text-xs text-slate-600">
                  Note
                  <input name="note" placeholder="optional" className={`mt-0.5 w-full ${field}`} />
                </label>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
                >
                  {pending ? 'Saving...' : 'Save & pin'}
                </button>
              </div>
              {err && <p className="text-xs text-rose-600">{err}</p>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
