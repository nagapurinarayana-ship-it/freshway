const CACHE = 'fw-owner-v18';
const SHELL = [
  '/admin/',
  '/admin/manifest.webmanifest',
  '/admin/icons/icon-192.svg',
  '/admin/icons/icon-512.svg',
  '/admin/owner-pwa-install.js?v=20261019-install-prompt-v2',
  '/admin/owner-pwa-install.css?v=20261019-install-prompt-v2',
  '/admin/admin.css?v=20261021-shop-location-picker-v1',
  '/admin/admin.js?v=20261020-owner-alert-login-ready-v1',
  '/admin/frontend/admin/order-alerts.js?v=20261020-owner-push-login-ready-v2',
  '/admin/frontend/phone-display.js?v=20261009-phone-display-v1',
  '/admin/frontend/admin/store-profile.js?v=20261021-free-osm-picker-v1',
  '/admin/frontend/catalogue-media.js?v=20261008-ui-media-v1',
  '/admin/frontend/admin/catalogue.js?v=20261009-full-image-fit-v1',
  '/admin/frontend/admin/owner-lifecycle-autosave.js?v=20260909-owner-lifecycle-v1',
  '/admin/frontend/admin/push.js?v=20260908-push-v1',
  '/admin/owner-lifecycle.js?v=20261020-compact-location-row-v1',
  '/admin/owner-address-final.js?v=20260909-address-final-v6',
  '/admin/freshway-logo-master.webp?v=20261008-master-v1',
  '/admin/freshway-logo-clean.svg?v=20261008-brand-v1',
  '/admin/frontend/media/catalogue/groundnut-oil.svg',
  '/admin/frontend/media/catalogue/sunflower-oil.svg',
  '/admin/frontend/media/catalogue/hmt-rice.svg',
  '/admin/frontend/media/catalogue/sona-masuri.svg'
];
const REQUIRED_SHELL = [
  '/admin/',
  '/admin/manifest.webmanifest',
  '/admin/owner-pwa-install.js?v=20261019-install-prompt-v2',
  '/admin/admin.css?v=20261021-shop-location-picker-v1',
  '/admin/admin.js?v=20261020-owner-alert-login-ready-v1',
  '/admin/frontend/admin/order-alerts.js?v=20261020-owner-push-login-ready-v2',
  '/admin/frontend/admin/catalogue.js?v=20261009-full-image-fit-v1',
  '/admin/frontend/admin/store-profile.js?v=20261021-free-osm-picker-v1'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const results = await Promise.all(SHELL.map(async asset => {
      try {
        const response = await fetch(new Request(asset, { cache: 'no-store' }));
        if (!response.ok) throw new Error('HTTP ' + response.status);
        await cache.put(asset, response.clone());
        return true;
      } catch (error) {
        console.error('FreshWay Owner service-worker shell asset failed:', asset, error);
        return false;
      }
    }));

    if (!REQUIRED_SHELL.every(asset => results[SHELL.indexOf(asset)])) {
      throw new Error('FreshWay Owner critical app shell could not be cached.');
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('fw-owner-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  // A path-scoped service worker must never handle customer pages or API writes.
  if (!url.pathname.startsWith('/admin/')) return;
  const isDocument = request.mode === 'navigate' || request.destination === 'document';
  const isCode = ['script', 'style'].includes(request.destination);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.pathname === '/admin/' || url.pathname === '/admin/index.html' ? '/admin/' : request;

    try {
      const response = await fetch(new Request(request, { cache: 'no-store' }));
      if (response.ok && (isDocument || ['script','style','image','font','manifest'].includes(request.destination))) {
        cache.put(key, response.clone()).catch(error => console.error('Owner cache update failed:', request.url, error));
      }
      return response;
    } catch (error) {
      console.error('FreshWay Owner request failed:', request.url, error);
      const cached = await cache.match(key) || await cache.match(request);
      if (cached) return cached;
      if (isDocument) return await cache.match('/admin/') || Response.error();
      return Response.error();
    }
  })());
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (_) { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'FreshWay order alert', {
    body: data.body || 'There is an update to a FreshWay order.',
    icon: data.icon || '/admin/icons/icon-192.svg',
    badge: data.badge || '/admin/icons/icon-192.svg',
    tag: data.tag || 'freshway-owner-order-alert',
    data: { url: data.url || '/admin/#orders', ...(data.data || {}) }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = '/admin/';
  try { const targetUrl = new URL(event.notification.data?.url || '/admin/', self.location.origin); if (targetUrl.origin === self.location.origin && targetUrl.pathname.startsWith('/admin/')) target = targetUrl.pathname + targetUrl.search + targetUrl.hash; } catch (_) {}
  event.waitUntil((async () => {
    const pages = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = pages.find(client => new URL(client.url).pathname.startsWith('/admin/'));
    if (same) {
      await same.focus();
      if ('navigate' in same) await same.navigate(target);
    } else if (clients.openWindow) {
      await clients.openWindow(target);
    }
  })());
});
