const CACHE = 'freshway-v27';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=20261008-mobile-visual-v1',
  '/address-system.css?v=20260907-address-v2',
  '/app.js?v=20261008-state-sync-v1',
  '/frontend/customer/product-view.js?v=20261008-mobile-visual-v1',
  '/notifications.js?v=20260907-auth-v2',
  '/address-fix.js?v=20261008-address-hotfix-v4',
  '/address-system-final.js?v=20261008-address-final-v6',
  '/manifest.webmanifest?v=20261007-install-v2',
  '/frontend/customer/pwa-install.css?v=20261007-install-v2',
  '/frontend/customer/seo.js?v=20261007-seo-v1',
  '/frontend/customer/pwa-install.js?v=20261007-install-v2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icon.svg?v=20260907-logo-v2',
  '/admin.html',
  '/admin.css?v=20261008-mobile-visual-v1',
  '/admin.js?v=20261008-mobile-visual-v1',
  '/frontend/admin/catalogue.js?v=20261008-product-images-v1',
  '/owner-lifecycle.js?v=20260909-refresh-v3',
  '/owner-address-final.js?v=20260909-address-final-v6',
  '/freshway-logo-clean.svg?v=20260908-logo-v4'
];

const REQUIRED_SHELL = [
  '/',
  '/index.html?v=20261007-seo-v1'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const results = await Promise.all(APP_SHELL.map(async asset => {
      try {
        const response = await fetch(new Request(asset, { cache: 'no-cache' }));
        if (!response.ok) throw new Error('HTTP ' + response.status);
        await cache.put(asset, response.clone());
        return true;
      } catch (error) {
        console.error('FreshWay service worker shell asset failed:', asset, error);
        return false;
      }
    }));
    if (!REQUIRED_SHELL.every(asset => results[APP_SHELL.indexOf(asset)])) {
      throw new Error('FreshWay critical app shell could not be cached.');
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const url = new URL(event.request.url);
      const isLogo = url.pathname === '/freshway-logo-clean.svg';
      const isOwnerLifecycle = url.pathname === '/owner-lifecycle.js';
      const request = isLogo
        ? new Request(event.request, { cache: 'reload' })
        : isOwnerLifecycle
          ? new Request(`${url.origin}/owner-lifecycle.js?v=20260909-refresh-v3`, event.request)
          : event.request;

      const response = await fetch(request);
      if (response.ok && ['document', 'script', 'style', 'image', 'manifest'].includes(event.request.destination)) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      return cached || (event.request.mode === 'navigate'
        ? caches.match('/index.html?v=20261007-seo-v1')
        : Response.error());
    }
  })());
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch (_) {
    data = { body: event.data.text() };
  }

  event.waitUntil(self.registration.showNotification(data.title || 'FreshWay', {
    body: data.body || 'You have a new FreshWay update.',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    tag: data.tag || 'freshway-notification',
    data: { url: data.url || '/', ...(data.data || {}) }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    const pages = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = pages.find(client => client.url.startsWith(self.location.origin));

    if (same) {
      await same.focus();
      if ('navigate' in same) await same.navigate(target);
    } else if (clients.openWindow) {
      await clients.openWindow(target);
    }
  })());
});
