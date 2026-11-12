// 오프라인 안내 한 장만 저장합니다. 로그인·메모 API 응답은 가로채거나 저장하지 않습니다.
const OFFLINE = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open('offline-v1').then(cache => cache.add(OFFLINE)));
});

self.addEventListener('fetch', event => {
  // 화면 이동만 다루며, 연결되어 있으면 서버 응답(401·404 포함)을 그대로 돌려줍니다.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
