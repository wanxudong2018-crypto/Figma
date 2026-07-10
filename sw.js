const CACHE_NAME = 'eagle-share-sw-v1';

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('eagle-share-store', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await idbOpen();
    return new Promise((resolve) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.error('[Eagle SW] idbSet error', e); }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ─── 接收来自 mobile-eagle.html 的凭证存储消息 ────────────────────────────────────

self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'STORE_CREDENTIALS') {
    const { sid, t, api, client } = event.data;
    await idbSet('credentials', { sid, t, api, client: client || 'eagle' });
    if (event.source) {
      event.source.postMessage({ type: 'CREDENTIALS_STORED', sid, api });
    }
  }
});

// ─── 拦截 Android Share Target POST ──────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.includes('mobile-eagle-share.html')) {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const mediaFiles = formData.getAll('media');

    if (!mediaFiles || mediaFiles.length === 0) {
      return Response.redirect('/Figma/mobile-eagle.html?shared=1&error=no_file', 303);
    }

    // 读取存储的凭证
    const creds = await idbGet('credentials');
    if (!creds || !creds.sid || !creds.t || !creds.api) {
      // 没有凭证：缓存图片，引导用户扫码配置
      const cache = await caches.open(CACHE_NAME);
      // 逐个缓存，支持多图
      for (let i = 0; i < mediaFiles.length; i++) {
        await cache.put(`/shared-media-${i}`, new Response(mediaFiles[i]));
      }
      await cache.put('/shared-media-count', new Response(String(mediaFiles.length)));
      return Response.redirect('/Figma/mobile-eagle.html?shared=1&error=no_creds&pending=' + mediaFiles.length, 303);
    }

    // 逐张上传到云端（复用 Eagle 版 /api/upload 接口）
    let uploadedCount = 0;
    let lastErrorCode = '';
    for (let i = 0; i < mediaFiles.length; i++) {
      try {
        const file = mediaFiles[i];
        const base64 = await fileToBase64(file);
        const fileId = createFileId();

        // 构造与 mobile-eagle.html 一致的上传 payload
        const payload = {
          sid: creds.sid,
          t: creds.t,
          client: creds.client || 'eagle',
          image: base64,
          id: fileId,
          isOriginal: false,
          imageInfo: {
            originalBytes: file.size || 0,
            compressedBytes: estimateDataUrlBytes(base64)
          }
        };

        const uploadUrl = new URL('/api/upload', creds.api);
        uploadUrl.searchParams.set('client', creds.client || 'eagle');

        const res = await fetch(uploadUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.ok) {
          uploadedCount++;
        } else {
          lastErrorCode = data.errorCode || data.error || 'upload_failed';
          // 额度相关错误，停止继续上传
          if (['QUOTA_EXCEEDED', 'ORIGINAL_REQUIRES_PREMIUM', 'ORIGINAL_QUOTA_EXCEEDED', 'TOO_MANY_PENDING_IMAGES'].includes(lastErrorCode)) {
            break;
          }
        }
      } catch (e) {
        lastErrorCode = 'network_error';
      }
    }

    if (uploadedCount > 0) {
      return Response.redirect(
        `/Figma/mobile-eagle.html?shared=1&count=${uploadedCount}&total=${mediaFiles.length}`,
        303
      );
    } else {
      return Response.redirect(
        `/Figma/mobile-eagle.html?shared=1&error=${lastErrorCode}`,
        303
      );
    }

  } catch (e) {
    console.error('[Eagle SW] Share Target Error:', e);
    return Response.redirect('/Figma/mobile-eagle.html?shared=1&error=sw_error', 303);
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

async function fileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  const mime = file.type || 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

function estimateDataUrlBytes(dataUrl) {
  let b64 = String(dataUrl || '').replace(/\s/g, '');
  if (b64.includes('base64,')) b64 = b64.split('base64,')[1];
  const padding = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function createFileId() {
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
  return `img_${Date.now()}_${suffix}`;
}
