// Kohler service worker: makes the site installable and keeps it usable on a bad connection.
// Pages, scripts and styles always come from the network first (so a new deploy shows up at
// once) and fall back to the last copy only when offline. Money and account calls (/api) are
// never cached. Avatar pictures and flags never change, so they're served from the cache.
const VERSION = 'kohler-v3';
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/assets/logo.svg', '/assets/app/icon-192.png', '/kohler.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const immutable = (url) => url.pathname.startsWith('/avatars/') || url.pathname.startsWith('/assets/flags/');

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/studio/api') || url.pathname.startsWith('/admin')) return;

  if (immutable(url)) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') { const c = await caches.open(VERSION); c.put(req, res.clone()); }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match(OFFLINE);
      return Response.error();
    }
  })());
});
