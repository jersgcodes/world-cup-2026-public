// Network-first service worker. The app is a single static shell on GitHub Pages, which
// serves index.html with a 10-minute browser cache — so an installed PWA kept showing a
// stale build ("I don't see the changes"). With this SW, every same-origin GET tries the
// network FIRST (bypassing the HTTP cache) and only falls back to cache when offline, so
// the latest index.html / data.json arrive on every launch. Cross-origin (ESPN, jsdelivr,
// GitHub API) is left untouched and governed by the page CSP.
const CACHE = 'wc26-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  await self.clients.claim();
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // let cross-origin pass through normally
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-store' });   // always go to network first
      if (fresh && fresh.ok) { const c = await caches.open(CACHE); c.put(req, fresh.clone()); }
      return fresh;
    } catch {
      // offline → last good copy. ignoreSearch so a cache-busted URL (e.g. data.json?b=…)
      // still matches the stored copy instead of missing on the changing query string.
      const cached = await caches.match(req, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});
