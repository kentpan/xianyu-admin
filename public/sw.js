/**
 * Service Worker — offline caching for xianyu-admin.
 * Cache-first for static assets, network-first for API/HTML.
 */
const CACHE_NAME = 'xianyu-admin-v2.1.0'
const STATIC_ASSETS = [
  '/xianyu/favicon.svg',
  '/xianyu/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Only handle GET requests on same origin
  if (req.method !== 'GET') return
  if (url.origin !== self.location.origin) return

  // Skip API requests (always network-first, don't cache)
  if (url.pathname.includes('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response('{"success":false,"code":503,"message":"离线模式"}', { headers: { 'content-type': 'application/json' } })))
    return
  }

  // Static assets — cache-first
  if (url.pathname.match(/\.(js|css|svg|png|jpg|woff2?|ico)$/)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone))
        }
        return res
      })),
    )
    return
  }

  // HTML pages — network-first, fallback to cache
  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone))
        }
        return res
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('/xianyu/'))),
    )
    return
  }
})
