const CACHE = 'fw-owner-v1';
const SHELL = [
  '/admin/',
  '/admin/manifest.webmanifest',
  '/admin.css?v=20261008-mobile-visual-v1',
  '/admin.js?v=20261018-test-orders-v2',
  '/frontend/admin/catalogue.js?v=20261009-full-image-fit-v1',
  '/owner-lifecycle.js?v=20261009-phone-display-v1',
  '/owner-address-final.js?v=20260909-address-final-v6',
  '/freshway-logo-master.webp?v=20261008-master-v1',
  '/freshway-logo-clean.svg?v=20261008-brand-v1'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      try {
        const response = await fetch(new Request(path, { cache: 'no-store' }));
        if (response.ok) await cache.put(path, response.clone());
      } catch (error) {
        console.warn('FreshWay Owner shell asset unavailable:', path, error);
      }
    }));
    if (!await cache.match('/admin/')) throw new Error('Owner app shell could not be cached');
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
  if (!url.pathname.startsWith('/admin/') && !SHELL.some(path => new URL(path, self.location.origin).pathname === url.pathname)) return;
  if (url.pathname.startsWith('/api/')) return;
  const isDocument = request.mode === 'navigate' || request.destination === 'document';
  const isCode = ['script', 'style'].includes(request.destination);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.pathname === '/admin/' || url.pathname === '/admin/index.html' ? '/admin/' : request;
    try {
      const response = await fetch(new Request(request, { cache: 'no-store' }));
      if (response.ok && (isDocument || ['script','style','image','font','manifest'].includes(request.destination))) {
        cache.put(key, response.clone()).catch(error => console.warn('Owner cache update failed:', error));
      }
      return response;
    } catch (error) {
      const cached = await cache.match(key) || await cache.match(request);
      if (cached && !isCode) return cached;
      if (isDocument) return await cache.match('/admin/') || Response.error();
      return cached || Response.error();
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/admin/';
  event.waitUntil((async () => {
    const pages = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = pages.find(client => new URL(client.url).pathname.startsWith('/admin'));
    if (same) {
      await same.focus();
      if ('navigate' in same) await same.navigate(target);
    } else if (clients.openWindow) {
      await clients.openWindow(target);
    }
  })());
});
