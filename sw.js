const CACHE = 'freshway-v8';
const APP_SHELL = [
  '/',
  '/index.html?v=20260907-v8',
  '/styles.css?v=20260907-layout-v2',
  '/address-system.css?v=20260907-address-v2',
  '/app.js?v=20260907-app-v2',
  '/notifications.js?v=20260907-auth-v2',
  '/address-fix.js?v=20260907-address-fix',
  '/address-system-final.js?v=20260907-address-final-v3',
  '/manifest.webmanifest?v=20260907-v8',
  '/icon.svg?v=20260907-logo-v2',
  '/admin.html',
  '/admin.css?v=20260907-owner-v2',
  '/admin.js?v=20260907-owner-v4',
  '/owner-lifecycle.js?v=20260907-owner-v2',
  '/owner-address-final.js?v=20260907-address-final-v3',
  '/freshway-logo-clean.svg?v=20260907-logo-v3'
];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && ['document','script','style','image','manifest'].includes(event.request.destination)) {
        const cache = await caches.open(CACHE); cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      return cached || (event.request.mode === 'navigate' ? caches.match('/index.html?v=20260907-v8') : Response.error());
    }
  })());
});
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (_) { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'FreshWay', {
    body: data.body || 'You have a new FreshWay update.',
    icon: data.icon || '/icon.svg', badge: data.badge || '/icon.svg',
    tag: data.tag || 'freshway-notification', data: { url: data.url || '/', ...(data.data || {}) }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const pages = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = pages.find(client => client.url.startsWith(self.location.origin));
    if (same) { await same.focus(); if ('navigate' in same) await same.navigate(target); }
    else if (clients.openWindow) await clients.openWindow(target);
  })());
});
