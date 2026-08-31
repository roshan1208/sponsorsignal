/*
 * SponsorSignal service worker — deliberately minimal.
 *
 * Strategy:
 *   data/*.json  network-first (cache only as an offline fallback), because
 *                showing a stale register would be worse than showing none.
 *   everything    stale-while-revalidate: instant from cache, refreshed in
 *   else          the background, so a deploy is picked up on the next load.
 *
 * Bump CACHE when the shell changes to evict the old one.
 */
const CACHE = 'sponsorsignal-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    // addAll rejects the whole install if any single entry 404s, so add
    // them individually and tolerate misses.
    caches.open(CACHE)
      .then(cache => Promise.all(
        SHELL.map(url => cache.add(url).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Never touch anything but same-origin GETs (analytics, fonts, form posts).
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(response => {
      if (response && response.ok) {
        caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => null);

  return cached || network.then(r => r || Response.error());
}
