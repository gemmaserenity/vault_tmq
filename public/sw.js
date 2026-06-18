const CACHE = 'vault-tmq-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/vault.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Never intercept API or Stripe calls
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.hostname.includes('stripe')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
