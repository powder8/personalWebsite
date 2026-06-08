'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * GoatCounter analytics (shared site: badoo.goatcounter.com), with two app-
 * specific touches:
 *  1. UUID path segments (athlete ids in /athletes/<id> and /me/<id>) are
 *     masked to ":id" before sending, so analytics show page TYPES without
 *     exposing individual athletes.
 *  2. Client-side (SPA) navigations are counted — count.js only auto-counts the
 *     initial load, so we count subsequent route changes ourselves.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

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
      firstLoad.current = false; // initial pageview is counted by count.js
      return;
    }
    window.goatcounter?.count?.({ path: location.pathname + location.search });
  }, [pathname]);

  // One script: set the UUID-masking path filter, THEN inject count.js (so the
  // filter is in place before count.js auto-counts the first pageview).
  return (
    <Script id="goatcounter" strategy="afterInteractive">
      {`window.goatcounter={path:function(p){return p.replace(${UUID.toString()},':id')}};
        (function(){var s=document.createElement('script');s.async=true;
        s.dataset.goatcounter='https://badoo.goatcounter.com/count';
        s.src='//gc.zgo.at/count.js';document.head.appendChild(s);})();`}
    </Script>
  );
}
