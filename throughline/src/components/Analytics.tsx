'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Counts client-side (SPA) navigations for GoatCounter. The initial pageview +
 * the UUID-masking path filter are set by a server-rendered inline script in the
 * root layout (so they're in the SSR HTML and run on first load); this only adds
 * counts for subsequent in-app route changes, which count.js doesn't do itself.
 */
declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string }) => void; path?: (p: string) => string };
  }
}

export function Analytics() {
  const pathname = usePathname();
  const firstLoad = useRef(true);

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false; // initial pageview counted by count.js
      return;
    }
    window.goatcounter?.count?.({ path: location.pathname + location.search });
  }, [pathname]);

  return null;
}
