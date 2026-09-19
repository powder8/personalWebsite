/* Throughline service worker.
 *
 * Deliberately conservative: this is a live coaching app, so pages are always
 * fetched from the network (a stale "today" would be wrong). The worker only
 *   - caches immutable static assets (Next's hashed /_next/static, icons),
 *   - serves an offline page when a navigation has no network,
 *   - and provides the registration Web Push will hang off.
 * Nothing under /api or /auth is ever cached.
 */
const VERSION = 'tl-v1';
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth')) return;

  // Navigations: network, then the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Hashed static assets + icons: cache-first (they never change under a URL).
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) caches.open(STATIC_CACHE).then((c) => c.put(request, res.clone()));
        return res;
      })),
    );
  }
});
