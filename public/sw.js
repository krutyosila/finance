const CACHE_NAME = 'kasa-static-v1';
const PUBLIC_FILES = new Set([
  '/offline.html',
  '/manifest.webmanifest',
  '/brand/kasa-mark.svg',
  '/brand/kasa-mark-mint.svg',
  '/brand/kasa-logo.svg',
  '/brand/kasa-logo-light.svg',
  '/favicon.ico',
  '/icons/favicon-32.png',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/maskable-icon.svg',
  '/icons/apple-touch-icon.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([...PUBLIC_FILES])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith('still-static-') || key.startsWith('kasa-static-')) &&
                key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Financial and authentication requests always go directly to the server.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/')
  )
    return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.open(CACHE_NAME)).match('/offline.html')),
    );
    return;
  }

  if (!PUBLIC_FILES.has(url.pathname) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque' && !response.redirected)
        await cache.put(request, response.clone());
      return response;
    }),
  );
});
