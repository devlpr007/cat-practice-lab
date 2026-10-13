// Service worker: keeps every app file on the device so the app opens and works with no internet.
// Only app code is stored here; your tests, pictures and attempts live in IndexedDB (never online).
// One cache per app version. A new version is downloaded in the background and used the next time
// the app is opened after all its tabs were closed — never in the middle of a test.
/* global self, caches */
importScripts('offline-files.js');
const CACHE = `cat-practice-lab-${self.OFFLINE_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(self.OFFLINE_FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k.startsWith('cat-practice-lab-') && k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    // the very first install: the page that is already open uses the offline copy at once (so it keeps
    // working if the internet goes away before the app is opened again). A later version never takes
    // over an open page by itself; the user is asked first (main.js), never during a test.
    if (!old.length) await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'activate-update') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./');
      if (shell) return shell;
    }
    return fetch(req);
  })());
});
