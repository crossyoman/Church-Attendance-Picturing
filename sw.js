/* 오프라인 캐시 (항상 최신 본을 먼저 시도하고, 안 되면 캐시 사용) */
const CACHE = 'cheongun-v8';
const ASSETS = ['./', './index.html', './css/style.css?v=8', './js/config.js?v=8', './js/db.js?v=8', './js/api.js?v=8', './js/store.js?v=8',
  './js/report.js?v=8', './js/camera.js?v=8', './js/admin.js?v=8', './js/app.js?v=8', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
