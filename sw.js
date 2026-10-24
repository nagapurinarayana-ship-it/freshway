const CACHE = 'freshway-v78';
const APP_SHELL = [
'/',
'/index.html',
'/styles.css?v=20261025-zepto-home-location-v1',
'/frontend/customer/category-fold-fit.css?v=20261021-full-images-refresh-v2',
'/address-system.css?v=20260907-address-v2',
'/frontend/customer/address-book.css?v=20261020-address-ui-hardening-v2',
'/frontend/customer/serviceability.css?v=20261025-serviceable-areas-v1',
'/frontend/customer/checkout-submit.js?v=20261025-serviceable-areas-v1',
'/frontend/customer/serviceability-experience.js?v=20261025-serviceable-areas-v1',
'/app.js?v=20261021-home-navigation-refresh-v1',
'/frontend/customer/orders-view.js?v=20261022-invoice-status-copy-v2',
  '/frontend/customer/invoice-download.js?v=20261022-customer-invoice-v1',
'/frontend/phone-display.js?v=20261009-phone-display-v1',
'/frontend/customer/product-view.js?v=20261019-catalogue-premium-v1',
'/frontend/customer/catalogue.js?v=20261025-home-loading-fix-v1',
'/notifications.js?v=20261020-normalized-auth-phone-v2',
'/address-fix.js?v=20261009-address-fallback-safety-v5',
'/frontend/customer/address-geocode.js?v=20261021-guest-address-map-search-v3',
'/address-system-final.js?v=20261021-guest-address-map-search-v3',
'/frontend/customer/pwa-install.css?v=20261007-install-v2',
'/frontend/customer/seo.js?v=20261007-seo-v1',
'/frontend/customer/promotions.js?v=20261021-promo-natural-fit-v4',
'/frontend/customer/store-info.js?v=20261021-shop-map-link-v1',
'/frontend/customer/profile.js?v=20261009-customer-profile-v2',
'/icons/icon-192.svg?v=20261008-brand-v1',
'/icons/icon-512.svg?v=20261008-brand-v1',
'/frontend/customer/pwa-install.js?v=20261024-native-install-v1',
'/icon.svg?v=20261008-brand-v1',
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
      keys.filter(key => key.startsWith('freshway-') && key !== CACHE).map(key => caches.delete(key))
    ))
    .then(() => self.clients.claim())
);
});
self.addEventListener('fetch', event => {
if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
const url = new URL(event.request.url);
if (url.pathname === '/admin.html' || url.pathname.startsWith('/admin/')) return;
const destination = event.request.destination;
const isNavigation = event.request.mode === 'navigate' || destination === 'document';
const isStaticAsset = ['script','style','image','font','manifest'].includes(destination);
if (!isNavigation && !isStaticAsset) return;
event.respondWith((async () => {
  const isLogo = url.pathname === '/freshway-logo-clean.svg';
  const isVersionedCode = ['script','style'].includes(destination) && url.searchParams.has('v');
  const request = isLogo ? new Request(event.request, { cache: 'reload' }) : new Request(event.request, { cache: 'no-store' });
  const cache = await caches.open(CACHE);
  if (isNavigation && ['/', '/index.html'].includes(url.pathname)) {
    const key = url.pathname === '/index.html' ? '/index.html' : '/';
    try {
      const response = await fetch(new Request(event.request, { cache: 'no-store' }));
      if (response.ok) cache.put(key, response.clone()).catch(error => console.error('FreshWay document cache update failed:', error));
      return response;
    } catch (error) {
      console.error('FreshWay document fetch failed:', event.request.url, error);
      return (await cache.match(key)) || (key === '/' ? await cache.match('/index.html') : null) || Response.error();
    }
  }
  const cached = await cache.match(event.request);
  if (cached && isVersionedCode) return cached;
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
  if (cached) {
    event.waitUntil(update.catch(() => undefined));
    return cached;
  }
  try {
    return await update;
  } catch (_) {
    if (isNavigation) return (await cache.match('/index.html')) || Response.error();
    return (await cache.match(event.request)) || Response.error();
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
event.waitUntil((async () => {
  await self.registration.showNotification(data.title || 'FreshWay', {
    body: data.body || 'You have a new FreshWay update.',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    tag: data.tag || 'freshway-notification',
    data: { url: data.url || '/', ...(data.data || {}) }
  });

  const alert = data.data || {};
  if (alert.audience !== 'customer' || !alert.orderId) return;
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(pages.map(async client => {
    try {
      const page = new URL(client.url);
      if (page.origin !== self.location.origin || page.pathname.startsWith('/admin/') || page.pathname === '/admin.html') return;
      client.postMessage({
        type: 'freshway:order-updated',
        audience: 'customer',
        orderId: String(alert.orderId),
        eventType: String(alert.eventType || 'order_update')
      });
    } catch (_) {}
  }));
})());
});
self.addEventListener('notificationclick', event => {
event.notification.close();
const target = event.notification.data?.url || '/';
event.waitUntil((async () => {
  const pages = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const same = pages.find(client => {
    try {
      const page = new URL(client.url);
      return page.origin === self.location.origin && !page.pathname.startsWith('/admin/') && page.pathname !== '/admin.html';
    } catch (_) { return false; }
  });
  if (same) {
    await same.focus();
    if ('navigate' in same) await same.navigate(target);
  } else if (clients.openWindow) {
    await clients.openWindow(target);
  }
})());
});
