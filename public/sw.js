const CACHE_NAME = 'rechnungs-log-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/favicon.svg',
  '/rl-app-icon-192.png',
  '/rl-app-icon-512.png',
  '/manifest.json?v=3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Network-first strategy so live database/API data and icons are always fresh
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
