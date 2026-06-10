'use client';

import { useState } from 'react';

interface Result {
  ok?: boolean;
  athleteId?: string;
  totals?: { activities: number; dateBugFixes: number; pacesParsed: number };
  perFile?: { url: string; ok: boolean; error?: string }[];
  error?: string;
}

export function FileUploadForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const res = await fetch('/api/import/files', { method: 'POST', body: new FormData(e.currentTarget) });
      setResult(await res.json());
    } catch {
      setResult({ error: 'Upload failed.' });
    } finally {
      setPending(false);
    }
  }

  const field = 'mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-600">
          Athlete name
          <input name="name" required placeholder="Heather Tanner" className={field} />
        </label>
        <label className="text-xs text-slate-600">
          Email (unique id)
          <input name="email" type="email" required placeholder="heather@…" className={field} />
        </label>
        <label className="text-xs text-slate-600">
          Year (weekly-format files)
          <input name="year" type="number" defaultValue={new Date().getFullYear()} className={field} />
        </label>
      </div>
      <label className="block text-xs text-slate-600">
        Training-log files (.xlsx — select multiple)
        <input name="files" type="file" accept=".xlsx,.xls" multiple required className={`${field} py-1`} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {pending ? 'Uploading…' : 'Upload & import'}
      </button>
      {result?.error && (
        <p className="rounded bg-rose-400/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-inset ring-rose-400/30">{result.error}</p>
      )}
      {result?.ok && result.totals && (
        <div className="rounded bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
          Imported <strong>{result.totals.activities}</strong> runs across {result.perFile?.length} file(s) ·{' '}
          {result.totals.pacesParsed} paces · {result.totals.dateBugFixes} date-range fixes.{' '}
          <a className="font-medium underline" href={`/athletes/${result.athleteId}`}>
            View athlete →
          </a>
          {result.perFile?.some((f) => !f.ok) && (
            <ul className="mt-1 list-disc pl-4 text-xs text-rose-300">
              {result.perFile.filter((f) => !f.ok).map((f) => (
                <li key={f.url}>
                  {f.url}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
