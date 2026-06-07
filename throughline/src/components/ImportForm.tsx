'use client';

import { useState } from 'react';

interface Result {
  ok?: boolean;
  athleteId?: string;
  activities?: number;
  rawEvents?: number;
  dateBugFixes?: number;
  pacesParsed?: number;
  error?: string;
}

export function ImportForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      url: String(fd.get('url') ?? ''),
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      year: String(fd.get('year') ?? ''),
    };
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(await res.json());
    } catch {
      setResult({ error: 'Network error — is the app reachable?' });
    } finally {
      setPending(false);
    }
  }

  const field = 'mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm';

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Google Sheets link</span>
        <input
          name="url"
          required
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className={field}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Set the sheet’s sharing to <strong>Anyone with the link → Viewer</strong> first.
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Athlete name</span>
          <input name="name" required placeholder="Moira Kahn" className={field} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email (unique id)</span>
          <input name="email" type="email" required placeholder="moira@…" className={field} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Build year</span>
          <input name="year" type="number" required defaultValue={2025} className={field} />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Importing…' : 'Import training log'}
      </button>

      {result?.error && (
        <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <div className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
          Imported <strong>{result.activities}</strong> runs ·{' '}
          {result.dateBugFixes} date-range fixes · {result.pacesParsed} paces parsed.{' '}
          <a className="font-medium underline" href={`/athletes/${result.athleteId}`}>
            View athlete →
          </a>
        </div>
      )}
    </form>
  );
}
