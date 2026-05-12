const CACHE_NAME = 'hamster-pwa-v2';

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
        try {
          const formData = await event.request.formData();
          const mediaFiles = formData.getAll('media');
          
          if (mediaFiles && mediaFiles.length > 0) {
            const cache = await caches.open('shared-files');
            await cache.put('/shared-media', new Response(mediaFiles[0]));
          }
          
          // 绝对路径重定向
          return Response.redirect('/Figma/mobile.html?shared=1', 303);
        } catch (e) {
          console.error('SW Error:', e);
          return Response.redirect('/Figma/mobile.html?error=sw', 303);
        }
      })()
    );
  }
});
