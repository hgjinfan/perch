import { isShellRequest } from './pwa/policy.js';

// Replaced by the server using a hash of all public shell files.
const VERSION = '__SHELL_VERSION__';
const SHELL = ['__SHELL_FILES__'];
const CACHE = `perch-shell-${VERSION}`;
const OFFLINE = '__OFFLINE_URL__';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              (name.startsWith('perch-shell-') || name.startsWith('kyrie-shell-')) &&
              name !== CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.mode === 'navigate' &&
    url.origin === self.location.origin &&
    ['/', '/index.html'].includes(url.pathname)
  ) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(OFFLINE)) || Response.error();
      }),
    );
    return;
  }
  if (!isShellRequest(event.request, self.location.origin, SHELL)) return;
  event.respondWith(
    (async () => {
      // Keep one coherent shell version until the user accepts an available update.
      const cache = await caches.open(CACHE);
      const stored = await cache.match(event.request);
      return stored || fetch(event.request);
    })(),
  );
});
