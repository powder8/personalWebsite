'use client';

import { useState } from 'react';

/**
 * Apple Health connection. HealthKit has no server API, so we can't pull data
 * ourselves. Instead the athlete installs an on-device exporter (Health Auto
 * Export) and points its REST automation at our ingest endpoint with a personal
 * token this generates. From then on HRV, resting HR, and sleep push to us daily.
 */
export function ConnectAppleHealth({ athleteId, connected }: { athleteId: string; connected: boolean }) {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [ingestUrl, setIngestUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'token' | 'url' | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/apple-health/token`, { method: 'POST' });
      const data = await res.json().catch(() => ({ error: 'Bad response.' }));
      if (!res.ok || !data.token) {
        setError(data.error ?? 'Could not generate a token.');
        return;
      }
      setToken(data.token);
      setIngestUrl(data.ingestUrl ?? null);
    } catch {
      setError('Network error, please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(what: 'token' | 'url', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked, the field is selectable anyway */
    }
  }

  return (
    <div className="space-y-3">
      {connected && !token && (
        <span className="inline-flex items-center rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
          Apple Health connected ✓
        </span>
      )}

      <p className="text-xs text-slate-400">
        Apple doesn&apos;t offer a way for apps to read Health data directly. This uses the free{' '}
        <span className="text-slate-300">Health Auto Export</span> app on your iPhone to push HRV, resting heart rate,
        and sleep to your plan each day.
      </p>

      {!token ? (
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="rounded border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
        >
          {busy ? 'Generating...' : connected ? 'Regenerate token' : 'Generate ingest token'}
        </button>
      ) : (
        <div className="space-y-3 rounded-lg bg-sky-400/10 px-3 py-3 ring-1 ring-inset ring-sky-400/20">
          <p className="text-xs font-medium text-amber-200">
            Copy this now, it&apos;s shown only once. Regenerating replaces it.
          </p>

          <Field label="Ingest URL" value={ingestUrl ?? ''} copied={copied === 'url'} onCopy={() => ingestUrl && copy('url', ingestUrl)} />
          <Field label="Token" value={token} copied={copied === 'token'} onCopy={() => copy('token', token)} mono />

          <div className="border-t border-slate-600/40 pt-2.5">
            <p className="mb-1.5 text-xs font-medium text-slate-300">Set it up in Health Auto Export</p>
            <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-400">
              <li>Install Health Auto Export from the App Store, open it.</li>
              <li>Create an Automation, choose REST API.</li>
              <li>Method POST. URL: the ingest URL above.</li>
              <li>
                Add a header <span className="text-slate-300">Authorization</span> with value{' '}
                <span className="text-slate-300">Bearer &lt;token&gt;</span>.
              </li>
              <li>Format JSON, aggregate by day.</li>
              <li>Pick the metrics: Heart Rate Variability, Resting Heart Rate, Sleep Analysis.</li>
              <li>Save. It pushes automatically each day.</li>
            </ol>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  copied,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-0.5 flex items-center gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 rounded border border-slate-600 bg-black/30 px-2 py-1 text-xs text-slate-200 ${mono ? 'font-mono' : ''}`}
        />
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
