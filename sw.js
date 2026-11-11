/* 오프라인 캐시 (항상 최신 본을 먼저 시도하고, 안 되면 캐시 사용) */
const CACHE = 'cheongun-v19';
const ASSETS = ['./', './index.html', './css/style.css?v=19', './js/config.js?v=19', './js/db.js?v=19', './js/api.js?v=19', './js/store.js?v=19',
  './js/report.js?v=19', './js/camera.js?v=19', './js/admin.js?v=19', './js/app.js?v=19', './manifest.json', './icon.svg'];

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
