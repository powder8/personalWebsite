'use client';

import { useState } from 'react';

/** Generic POST-then-reload button (e.g. remove/deactivate). */
export function PostButton({
  url,
  label,
  className = 'text-xs text-rose-600 hover:underline',
}: {
  url: string;
  label: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  async function go() {
    setPending(true);
    try {
      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      window.location.reload();
    } catch {
      setPending(false);
    }
  }
  return (
    <button onClick={go} disabled={pending} className={`${className} disabled:opacity-50`}>
      {label}
    </button>
  );
}
