/**
 * public/sw.js — SpeakSmart Service Worker
 *
 * Strategy:
 *  - Static assets (JS/CSS/fonts): Cache-first (fast loads)
 *  - API calls: Network-first with offline fallback message
 *  - Pages: Network-first with offline page fallback
 */

const CACHE_NAME = 'vachix-v1';

const PRECACHE_URLS = [
  '/',
  '/login',
  '/offline.html',
];

// ── Install: precache shell ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: routing strategies ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls → network-only (never cache sensitive data)
  if (url.pathname.startsWith('/api/')) return;

  // Static assets → cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.match(/\.(js|css|woff2?|png|jpg|svg|ico)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML pages → network-first, fall back to offline page
  event.respondWith(
    fetch(request).catch(() =>
      caches.match('/offline.html').then((r) => r ?? new Response('Offline', { status: 503 }))
    )
  );
});
