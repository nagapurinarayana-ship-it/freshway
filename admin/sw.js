const CACHE = 'fw-owner-v48';
const SHELL = [
  '/admin/',
  '/admin/manifest.webmanifest',
  '/admin/icons/icon-192-brand-v2.png?v=20261026-brand-v2',
  '/admin/icons/icon-512-brand-v2.png?v=20261026-brand-v2',
  '/admin/icons/icon-512-maskable-v2.png?v=20261026-brand-v2',
  '/admin/owner-pwa-install.js?v=20261019-install-prompt-v2',
  '/admin/owner-pwa-install.css?v=20261019-install-prompt-v2',
  '/admin/admin.css?v=20261027-store-management-v1',
  '/admin/admin.js?v=20261027-customer-messages-v1',
  '/admin/frontend/admin/invoice-settings.js?v=20261023-available-fields-invoice-v2',
  '/admin/frontend/admin/account-deletions.js?v=20261024-anonymized-history-v1',
  '/admin/frontend/admin/order-alerts.js?v=20261021-owner-push-diagnostics-v1',
  '/admin/frontend/phone-display.js?v=20261009-phone-display-v1',
  '/admin/frontend/admin/store-profile.js?v=20261024-response-guard-v2',
  '/admin/frontend/admin/delivery-management.js?v=20261026-date-only-v2',
  '/admin/frontend/admin/store-management.js?v=20261027-store-manager-v1',
  '/admin/frontend/admin/customer-messages.js?v=20261027-customer-messages-v1',
  '/admin/frontend/catalogue-media.js?v=20261008-ui-media-v1',
  '/admin/frontend/admin/catalogue.js?v=20261022-invoice-tax-fields-v1',
  '/admin/frontend/admin/owner-lifecycle-autosave.js?v=20260909-owner-lifecycle-v1',
  '/admin/frontend/admin/push.js?v=20260908-push-v1',
  '/admin/owner-lifecycle.js?v=20261027-owner-delivery-date-v1',
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
  '/admin/admin.css?v=20261027-store-management-v1',
  '/admin/admin.js?v=20261027-customer-messages-v1',
  '/admin/frontend/admin/account-deletions.js?v=20261024-anonymized-history-v1',
  '/admin/frontend/admin/order-alerts.js?v=20261021-owner-push-diagnostics-v1',
  '/admin/frontend/admin/catalogue.js?v=20261022-invoice-tax-fields-v1',
  '/admin/frontend/admin/store-profile.js?v=20261024-response-guard-v2',
  '/admin/frontend/admin/delivery-management.js?v=20261026-date-only-v2',
  '/admin/frontend/admin/store-management.js?v=20261027-store-manager-v1',
  '/admin/frontend/admin/customer-messages.js?v=20261027-customer-messages-v1',
  '/admin/frontend/admin/invoice-settings.js?v=20261023-available-fields-invoice-v2',
  '/admin/owner-lifecycle.js?v=20261027-owner-delivery-date-v1'
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
  const isManifest = request.destination === 'manifest';
  const isCode = ['script', 'style'].includes(request.destination);
  const isVersionedCode = isCode && url.searchParams.has('v');

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.pathname === '/admin/' || url.pathname === '/admin/index.html' ? '/admin/' : request;
    const cached = await cache.match(key) || await cache.match(request);
    // Versioned code is immutable by contract. Avoid the network entirely on a hit.
    if (cached && isVersionedCode) return cached;

    const fetchCurrent = () => fetch(new Request(request, { cache: 'no-store' }));
    const update = fetchCurrent().then(response => {
      if (response.ok && (isDocument || ['script','style','image','font','manifest'].includes(request.destination))) {
        cache.put(key, response.clone()).catch(error => console.error('Owner cache update failed:', request.url, error));
      }
      return response;
    }).catch(error => {
      console.error('FreshWay Owner request failed:', request.url, error);
      throw error;
    });

    // Documents and the manifest stay network-first so deployments/install metadata
    // are discovered promptly; cached copies are fallback-only for these resources.
    if (isDocument || isManifest) {
      try {
        return await update;
      } catch (_) {
        if (cached) return cached;
        if (isDocument) return await cache.match('/admin/') || Response.error();
        return Response.error();
      }
    }

    // Stable-path assets render from cache immediately and refresh in the background.
    if (cached) {
      event.waitUntil(update.catch(() => undefined));
      return cached;
    }

    try {
      return await update;
    } catch (_) {
      return await cache.match(key) || await cache.match(request) || Response.error();
    }
  })());
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (_) { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'FreshWay order alert', {
    body: data.body || 'There is an update to a FreshWay order.',
    icon: data.icon || '/admin/icons/icon-192-brand-v2.png?v=20261026-brand-v2',
    badge: data.badge || '/admin/icons/icon-192-brand-v2.png?v=20261026-brand-v2',
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
