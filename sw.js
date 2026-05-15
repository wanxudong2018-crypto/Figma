const CACHE_NAME = 'hamster-pwa-v3';

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hamster-store', 1);
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
  } catch (e) { console.error('idbSet error', e); }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ─── 接收来自 mobile.html 的凭证存储消息 ─────────────────────────────────────

self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'STORE_CREDENTIALS') {
    const { sid, t, api } = event.data;
    await idbSet('credentials', { sid, t, api });
    // 回复确认
    if (event.source) {
      event.source.postMessage({ type: 'CREDENTIALS_STORED', sid, api });
    }
  }
});

// ─── 拦截 Android Share Target POST ──────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.includes('mobile.html')) {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const mediaFiles = formData.getAll('media');

    if (!mediaFiles || mediaFiles.length === 0) {
      return Response.redirect('/Figma/mobile.html?shared=1&error=no_file', 303);
    }

    // 读取存储的凭证
    const creds = await idbGet('credentials');
    if (!creds || !creds.sid || !creds.t || !creds.api) {
      // 没有凭证：缓存图片，引导用户扫码配置
      const cache = await caches.open('shared-files');
      await cache.put('/shared-media', new Response(mediaFiles[0]));
      return Response.redirect('/Figma/mobile.html?shared=1&error=no_creds', 303);
    }

    // 逐张上传到云端
    let uploadedCount = 0;
    let lastError = '';
    for (const file of mediaFiles) {
      try {
        const base64 = await fileToBase64(file);
        const res = await fetch(
          `${creds.api}/api/upload?sid=${creds.sid}&t=${creds.t}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: base64,
              filename: file.name || `share_${Date.now()}.jpg`
            })
          }
        );
        const data = await res.json();
        if (data.ok) {
          uploadedCount++;
        } else {
          lastError = data.error || 'upload_failed';
        }
      } catch (e) {
        lastError = 'network_error';
      }
    }

    if (uploadedCount > 0) {
      return Response.redirect(
        `/Figma/mobile.html?shared=1&count=${uploadedCount}&total=${mediaFiles.length}`,
        303
      );
    } else {
      return Response.redirect(
        `/Figma/mobile.html?shared=1&error=${lastError}`,
        303
      );
    }

  } catch (e) {
    console.error('[SW] Share Target Error:', e);
    return Response.redirect('/Figma/mobile.html?shared=1&error=sw_error', 303);
  }
}

// ─── 将 File/Blob 转换为 base64 data URL（SW 环境无 FileReader）──────────────

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
