// SnapSort service worker — caches the app shell and CDN library so the app
// works offline once hosted. AI model files are cached separately by
// transformers.js in the browser cache.
const VERSION = 'snapsort-v1';
const CDN_CACHE = 'snapsort-cdn';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/categories.js',
  './js/db.js',
  './js/classifier.js',
  './js/viewer.js',
  './js/editor.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
    );
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    // stale-while-revalidate for the AI library
    e.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
  // Hugging Face model downloads pass through — transformers.js caches them.
});
