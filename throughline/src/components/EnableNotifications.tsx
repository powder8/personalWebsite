'use client';
/**
 * Turn on push notifications for this browser or installed app. This is how a
 * body-status change reaches the athlete without them opening the app.
 * On iPhone, push only works once the app is added to the Home Screen.
 */
import { useEffect, useState } from 'react';

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = 'checking' | 'unsupported' | 'needs_install' | 'off' | 'on' | 'blocked';

export function EnableNotifications({ athleteId, publicKey }: { athleteId: string; publicKey: string | null }) {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) {
        // iOS Safari only exposes push to an installed (Home Screen) app.
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        if (!cancelled) setState(ios ? 'needs_install' : 'unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState('blocked');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!cancelled) setState(sub ? 'on' : 'off');
    })().catch(() => !cancelled && setState('unsupported'));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await fetch(`/api/athletes/${athleteId}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error();
      setState('on');
      await fetch(`/api/athletes/${athleteId}/push`, { method: 'PUT' });
      setMsg('Notifications are on. We sent a test.');
    } catch {
      setMsg('Could not turn on notifications. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/athletes/${athleteId}/push`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState('off');
    } catch {
      setMsg('Could not turn off notifications. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'checking') return null;
  if (!publicKey) return <p className="text-sm text-slate-500">Notifications are not set up on the server yet.</p>;
  const pill = 'rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50';
  return (
    <div className="space-y-2">
      {state === 'on' ? (
        <>
          <p className="text-sm text-slate-600">Notifications are on for this device.</p>
          <button type="button" onClick={disable} disabled={busy} className={`${pill} bg-white/[0.08] text-white hover:bg-white/[0.12]`}>
            Turn off
          </button>
        </>
      ) : state === 'off' ? (
        <>
          <p className="text-sm text-slate-600">
            Get a notification when your recovery signals suggest illness or fatigue, and whenever your plan adjusts.
          </p>
          <button type="button" onClick={enable} disabled={busy} className={`${pill} bg-white text-[#0a0a0b] hover:bg-slate-800`}>
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
        </>
      ) : state === 'needs_install' ? (
        <p className="text-sm text-slate-600">
          On iPhone, add Throughline to your Home Screen first: tap Share, then <b className="text-white">Add to Home Screen</b>. Open it from there
          and return to this setting.
        </p>
      ) : state === 'blocked' ? (
        <p className="text-sm text-slate-600">Notifications are blocked for this site. Allow them in your browser settings, then reload.</p>
      ) : (
        <p className="text-sm text-slate-600">This browser does not support notifications.</p>
      )}
      {msg && <p role="status" className="text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
