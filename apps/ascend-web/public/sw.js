/* Minimal PWA shell cache (Phase 12, D12; fixed 2026-09-24): the shell is
   NETWORK-FIRST so a redeploy never serves a stale index.html that
   references deleted hashed assets (blank-page incident); hashed /assets/
   stay cache-first (content-hashed, immutable). API calls always go to the
   network (cross-origin requests pass through untouched). */
const SHELL_CACHE = 'ascend-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Content-hashed build artifacts: cache-first (safe — a new build emits
  // new names, so a cached entry is never wrong).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
    );
    return;
  }

  // The app shell (navigations + index.html): network-first so a redeploy is
  // picked up immediately; fall back to the cached shell only offline.
  if (event.request.mode === 'navigate' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Everything else same-origin (manifest, icons): cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
