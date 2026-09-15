'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Answers = { soreness: number | null; energy: number | null; yesterdayRpe: number | null;
  lifeStress?: number | null; sleepQuality?: number | null; note?: string | null };

export function CheckInForm({ athleteId, day, initial }: { athleteId: string; day: string; initial?: Answers | null }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(initial ?? { soreness: null, energy: null, yesterdayRpe: null, lifeStress: null, sleepQuality: null });
  const [note, setNote] = useState(initial?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const pending = saving || refreshing;
  const fields = [
    { key: 'energy', label: 'Energy', low: 'Drained', high: 'Full of energy' },
    { key: 'soreness', label: 'Muscle soreness', low: 'None', high: 'Very sore' },
    { key: 'sleepQuality', label: 'How restorative was your sleep?', low: 'Poor', high: 'Restorative' },
    { key: 'lifeStress', label: 'Life stress', low: 'Calm', high: 'Overwhelming' },
  ] as const;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true); setErr(null); setMessage('');
    try {
      const res = await fetch(`/api/athletes/${athleteId}/checkin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, ...answers, note }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Could not save.');
      setMessage('Saved. Your daily guidance is updated.');
      startTransition(() => router.refresh());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Network error. Please retry.'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-slate-600">Your body has a vote. Add what you know; unanswered signals stay unknown.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="block rounded-2xl bg-white/5 p-3">
            <span className="text-sm font-medium text-slate-900">{field.label}</span>
            <select value={answers[field.key] ?? ''} disabled={pending}
              onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.value === '' ? null : Number(e.target.value) })}
              className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm">
              <option value="">Not answered</option>
              {Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n}{n === 0 ? ` · ${field.low}` : n === 10 ? ` · ${field.high}` : ''}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">0 {field.low.toLowerCase()} · 10 {field.high.toLowerCase()}</span>
          </label>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer py-2 text-sm text-slate-600">Add yesterday’s effort or a note</summary>
        <label className="mt-2 block text-sm">Yesterday’s effort (0 rest · 10 maximal)
          <input type="number" min="0" max="10" step="1" value={answers.yesterdayRpe ?? ''}
            onChange={(e) => setAnswers({ ...answers, yesterdayRpe: e.target.value === '' ? null : Number(e.target.value) })}
            className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="mt-3 block text-sm">Anything else? (optional)
          <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Travel, a demanding day, or something your coach should know"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
      </details>
      <button type="submit" disabled={pending || !Object.values(answers).some((v) => typeof v === 'number')}
        className="min-h-11 rounded-xl bg-lime-300 px-5 py-2 text-sm font-semibold text-[#10141f] hover:bg-lime-200 disabled:opacity-50">
        {pending ? 'Updating your day…' : initial ? 'Update my check-in' : 'Check in & update my day'}
      </button>
      <p role="status" className="text-sm text-emerald-300">{message}</p>
      {err && <p role="alert" className="text-sm text-rose-300">{err}</p>}
    </form>
  );
}
