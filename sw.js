// Offline support: app shell cached; price data always tries the network first.
const SHELL = 'rbt-shell-v9';
const IMG = 'rbt-img-v1';
const FILES = ['fonts/marcellus-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, IMG].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // card images: cache-first
  if (url.hostname.includes('tcgplayer')) {
    e.respondWith(caches.open(IMG).then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); c.put(e.request, r.clone()); return r; } catch { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // data + app code: network first, fall back to cache when offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { // always check for a newer version
    if (r.ok && !url.pathname.includes('/vendor/')) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
