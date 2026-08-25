// Service Worker for GratefulDay PWA
//
// The build id arrives in the registration URL's query string
// (`/sw.js?v=<id>`, see main.tsx) rather than being stamped into this file:
// Vite copies public/ over the built output, so post-processing dist/sw.js
// silently lost the substitution. A changed registration URL is also what
// makes the browser treat this as a new worker at all.
const BUILD_ID = new URL(self.location.href).searchParams.get('v') || 'dev';

// Everything is resolved against the worker's own scope, never the origin
// root, so the app works identically at `/` and at a subpath like
// `/gratitude/`. `self.registration.scope` is an absolute URL ending in `/`.
const SCOPE = new URL(self.registration.scope);
const BASE = SCOPE.pathname; // e.g. "/" or "/gratitude/"
const scoped = (path) => BASE + path;
const INDEX_URL = scoped('index.html');

// Cache names carry the scope so two deployments on ONE origin (a shared host)
// can't collide.
const CACHE_PREFIX = `gratefulday${BASE.replace(/\//g, '_')}`;
const PRECACHE_NAME = `${CACHE_PREFIX}precache-${BUILD_ID}`;
const RUNTIME_NAME = `${CACHE_PREFIX}runtime-${BUILD_ID}`;
const MAX_RUNTIME_ENTRIES = 100;
const urlsToCache = [
  BASE,
  INDEX_URL,
  scoped('manifest.webmanifest'),
  scoped('android-chrome-192x192.png'),
  scoped('android-chrome-512x512.png'),
  scoped('apple-touch-icon.png'),
  scoped('favicon.ico'),
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Service Worker install error:', error);
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // ONLY our own caches. Deleting everything else would wipe the
          // caches of any other app sharing this origin — a real hazard when
          // deployed into a subdirectory of someone else's domain.
          if (
            cacheName.startsWith(CACHE_PREFIX) &&
            cacheName !== PRECACHE_NAME &&
            cacheName !== RUNTIME_NAME
          ) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Ensure the service worker takes control of all pages immediately
  return self.clients.claim();
});

// Keep the runtime cache bounded: drop oldest entries beyond the cap.
async function putWithLimit(request, response) {
  // Runtime cache is SEPARATE from the precache: they shared one cache, and
  // the eviction below removes oldest-first — which is exactly the precached
  // app shell, so a busy session used to delete its own offline fallback.
  const cache = await caches.open(RUNTIME_NAME);
  await cache.put(request, response);
  const keys = await cache.keys();
  if (keys.length > MAX_RUNTIME_ENTRIES) {
    // keys() returns insertion order; evict the oldest surplus entries.
    const surplus = keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES);
    await Promise.all(surplus.map((key) => cache.delete(key)));
  }
}

function isNavigation(request) {
  return request.mode === 'navigate' ||
    request.destination === 'document' ||
    new URL(request.url).pathname === INDEX_URL;
}

// Fetch event:
// - Navigations / index.html: network-first, so a new deploy's index.html (with
//   its fresh hashed asset URLs) is always picked up; cache is only a fallback
//   when offline.
// - Everything else: cache-first with a bounded runtime cache.
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip anything outside our own scope: cross-origin (Nostr relays), and on
  // a shared host, any sibling app living elsewhere on the same domain.
  if (!event.request.url.startsWith(SCOPE.origin + BASE)) {
    return;
  }

  if (isNavigation(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            putWithLimit(event.request, responseToCache);
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match(INDEX_URL);
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request).then((response) => {
          // Don't cache if not a valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          putWithLimit(event.request, responseToCache);

          return response;
        });
      })
      .catch(() => {
        // If both cache and network fail, return offline page if available
        if (event.request.destination === 'document') {
          return caches.match(INDEX_URL);
        }
      })
  );
});
