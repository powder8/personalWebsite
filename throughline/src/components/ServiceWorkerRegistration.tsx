'use client';

import { useEffect } from 'react';

/** Registers the service worker once the page has loaded (never on the critical path). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
