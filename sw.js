/* 오프라인 대비 캐시 (항상 최신 파일을 먼저 시도하고, 실패 시 캐시 사용) */
const CACHE = 'cheongun-v3';
const ASSETS = ['./', './index.html', './css/style.css', './js/config.js', './js/db.js', './js/api.js', './js/store.js',
  './js/report.js', './js/camera.js', './js/admin.js', './js/app.js', './manifest.json', './icon.svg'];

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
    fetch(e.request).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
