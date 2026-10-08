const CACHE = 'freshway-v42';

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=20261009-image-fit-v6',
  '/address-system.css?v=20260907-address-v2',
  '/app.js?v=20261009-store-profile-v3',
  '/frontend/phone-display.js?v=20261009-phone-display-v1',
  '/frontend/customer/product-view.js?v=20261008-mobile-visual-v1',
  '/notifications.js?v=20260907-auth-v2',
  '/address-fix.js?v=20261008-address-hotfix-v4',
  '/address-system-final.js?v=20261008-address-final-v6',
  '/frontend/customer/pwa-install.css?v=20261007-install-v2',
  '/frontend/customer/seo.js?v=20261007-seo-v1',
  '/frontend/customer/promotions.js?v=20261008-home-promotions-v1',
  '/frontend/customer/store-info.js?v=20261009-store-profile-v5',
  '/frontend/customer/profile.js?v=20261009-customer-profile-v2',
  '/icons/icon-192.svg?v=20261008-brand-v1',
  '/icons/icon-512.svg?v=20261008-brand-v1',
  '/frontend/customer/pwa-install.js?v=20261007-install-v2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icon.svg?v=20261008-brand-v1',
  '/admin.html',
  '/admin.css?v=20261008-mobile-visual-v1',
  '/admin.js?v=20261009-performance-v4',
  '/frontend/admin/catalogue.js?v=20261009-image-fit-v3',
  '/owner-lifecycle.js?v=20261009-phone-display-v1',
  '/owner-address-final.js?v=20260909-address-final-v6',
  '/freshway-logo-master.webp?v=20261008-master-v1',
  '/freshway-logo-clean.svg?v=20261008-brand-v1'
];

const REQUIRED_SHELL = [
  '/',
  '/index.html'
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

  const destination = event.request.destination;
  const isNavigation = event.request.mode === 'navigate' || destination === 'document';
  const isStaticAsset = ['script','style','image','font','manifest'].includes(destination);
  if (!isNavigation && !isStaticAsset) return;

  event.respondWith((async () => {
    const url = new URL(event.request.url);
    const isLogo = url.pathname === '/freshway-logo-clean.svg';
    const isOwnerLifecycle = url.pathname === '/owner-lifecycle.js';
    const request = isLogo
      ? new Request(event.request, { cache: 'reload' })
      : isOwnerLifecycle
        ? new Request(`${url.origin}/owner-lifecycle.js?v=20260909-refresh-v3`, event.request)
        : event.request;

    const cache = await caches.open(CACHE);

    // Owner login is a separate application surface. Never let a stale customer
    // shell or a broken cached document hide /admin.html. Prefer the live Owner
    // document, then fall back to its own cached copy during a transient outage.
    if (isNavigation && url.pathname === '/admin.html') {
      try {
        const response = await fetch(new Request(event.request, { cache: 'no-store' }));
        if (response.ok) {
          cache.put('/admin.html', response.clone()).catch(error =>
            console.error('FreshWay Owner document cache update failed:', error)
          );
        }
        return response;
      } catch (error) {
        console.error('FreshWay Owner document fetch failed:', event.request.url, error);
        return (await cache.match('/admin.html')) || Response.error();
      }
    }

    const cached = await cache.match(event.request);

    const update = fetch(request).then(response => {
      if (response.ok) {
        cache.put(event.request, response.clone()).catch(error =>
          console.error('FreshWay cache update failed:', event.request.url, error)
        );
      }
      return response;
    }).catch(error => {
      console.error('FreshWay asset fetch failed:', event.request.url, error);
      throw error;
    });

    // Customer shell and versioned assets can use stale-while-revalidate for fast
    // repeat loads without taking the Owner document path with them.
    if (cached) {
      event.waitUntil(update.catch(() => undefined));
      return cached;
    }

    try {
      return await update;
    } catch (_) {
      if (isNavigation) {
        return (await cache.match('/index.html')) || Response.error();
      }
      return Response.error();
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
