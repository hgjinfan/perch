import { isShellRequest } from './pwa/policy.js';

// Replaced by the server using a hash of all public shell files.
const VERSION = '__SHELL_VERSION__';
const SHELL = ['__SHELL_FILES__'];
const PRECACHE = ['__PRECACHE_FILES__'];
const CACHE = `perch-shell-${VERSION}`;
const OFFLINE = '__OFFLINE_URL__';
const LAUNCH = '__LAUNCH_URL__';
const BASE_PATH = __BASE_PATH__;
const ROOT = `${BASE_PATH}/`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
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
  const pagePath = url.pathname.startsWith(`${BASE_PATH}/page/`)
    ? url.pathname.slice(BASE_PATH.length)
    : '';
  if (
    event.request.mode === 'navigate' &&
    url.origin === self.location.origin &&
    !url.searchParams.has('direct') &&
    ([ROOT, `${BASE_PATH}/index.html`, `${BASE_PATH}/launch.html`].includes(url.pathname) ||
      /^\/page\/(?:latest|[a-f0-9]{20}\/[a-f0-9]{32})$/.test(pagePath))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const launch = await cache.match(LAUNCH);
        if (launch) return launch;
        try {
          return await fetch(event.request);
        } catch {
          return (await cache.match(OFFLINE)) || Response.error();
        }
      })(),
    );
    return;
  }
  if (!isShellRequest(event.request, self.location.origin, SHELL)) return;
  event.respondWith(
    (async () => {
      // Keep one coherent shell version until the user accepts an available update.
      const cache = await caches.open(CACHE);
      const stored = await cache.match(event.request);
      if (stored) return stored;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
