'use client';

import { useState } from 'react';

interface Result {
  ok?: boolean;
  athleteId?: string;
  totals?: { activities: number; dateBugFixes: number; pacesParsed: number };
  perFile?: { url: string; ok: boolean; error?: string }[];
  error?: string;
}

interface LinkRow {
  url: string;
  year: string;
}

export function ImportForm() {
  const [links, setLinks] = useState<LinkRow[]>([{ url: '', year: String(new Date().getFullYear()) }]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const update = (i: number, patch: Partial<LinkRow>) =>
    setLinks((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setLinks((rows) => [...rows, { url: '', year: String(new Date().getFullYear()) }]);
  const remove = (i: number) => setLinks((rows) => rows.filter((_, j) => j !== i));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      files: links.filter((l) => l.url.trim()).map((l) => ({ url: l.url, year: Number(l.year) })),
    };
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(await res.json());
    } catch {
      setResult({ error: 'Network error.' });
    } finally {
      setPending(false);
    }
  }

  const field = 'rounded border border-slate-300 px-2 py-1.5 text-sm';
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          Athlete name
          <input name="name" required placeholder="Moira Kahn" className={`mt-0.5 w-full ${field}`} />
        </label>
        <label className="text-xs text-slate-600">
          Email (unique id)
          <input name="email" type="email" required placeholder="moira@…" className={`mt-0.5 w-full ${field}`} />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">Google Sheets links (one per season)</span>
          <button type="button" onClick={add} className="text-xs font-medium text-sky-300 hover:underline">
            + Add another file
          </button>
        </div>
        {links.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={l.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className={`flex-1 ${field}`}
            />
            <input
              value={l.year}
              onChange={(e) => update(i, { year: e.target.value })}
              type="number"
              className={`w-20 ${field}`}
              title="Build year"
            />
            {links.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="text-xs text-rose-600">
                ✕
              </button>
            )}
          </div>
        ))}
        <p className="text-xs text-slate-500">
          Set each sheet’s sharing to <strong>Anyone with the link → Viewer</strong>.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Importing…' : 'Import from links'}
      </button>

      {result?.error && (
        <p className="rounded bg-rose-400/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-inset ring-rose-400/30">{result.error}</p>
      )}
      {result?.ok && result.totals && (
        <div className="rounded bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
          Imported <strong>{result.totals.activities}</strong> runs across {result.perFile?.length} file(s).{' '}
          <a className="font-medium underline" href={`/athletes/${result.athleteId}`}>
            View athlete →
          </a>
          {result.perFile?.some((f) => !f.ok) && (
            <ul className="mt-1 list-disc pl-4 text-xs text-rose-300">
              {result.perFile.filter((f) => !f.ok).map((f) => (
                <li key={f.url}>{f.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
