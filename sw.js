const CACHE = 'freshway-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (_) { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'FreshWay', {
    body: data.body || 'You have a new FreshWay update.',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
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
    if (same) { await same.focus(); if ('navigate' in same) await same.navigate(target); }
    else if (clients.openWindow) await clients.openWindow(target);
  })());
});
