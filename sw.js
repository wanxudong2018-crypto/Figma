const CACHE_NAME = 'hamster-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 拦截分享请求 (Share Target POST)
self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST' && event.request.url.includes('mobile.html')) {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const mediaFiles = formData.getAll('media');
        
        // 将分享的文件存入 CacheStorage，以便 mobile.html 读取
        const cache = await caches.open('shared-files');
        await cache.put('/shared-media', new Response(mediaFiles[0]));
        
        // 重定向到 mobile.html 并带上标记参数
        return Response.redirect('./mobile.html?shared=1', 303);
      })()
    );
  }
});
