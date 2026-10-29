const CACHE = 'freshway-v112';
const APP_SHELL = ['/','/index.html','/styles.css?v=20261027-delivery-offers-v1','/frontend/customer/design-system.css?v=ds3','/frontend/customer/delivery-offers.css?v=20261028-cart-offers-stable-v1','/frontend/customer/category-fold-fit.css?v=20261021-full-images-refresh-v2','/address-system.css?v=20260907-address-v2','/frontend/customer/address-book.css?v=20261027-checkout-ux-v2','/frontend/customer/storage.js?v=102','/frontend/customer/catalogue-cart.js?v=102','/frontend/customer/cart-persistence.js?v=102','/frontend/customer/checkout-submit.js?v=103','/frontend/customer/delivery-booking.js?v=20261029-date-persistence-v1','/app.js?v=102','/frontend/customer/delivery-offers.js?v=103','/frontend/customer/cart-view.js?v=102','/frontend/customer/cart-actions.js?v=20261028-cart-toast-guard-v1','/frontend/customer/cart-bar.js?v=20261029-cartbar-v2','/frontend/customer/navigation.js?v=20261028-nav-restore-v2','/frontend/customer/view-state.js?v=20261028-nav-restore-v2','/frontend/customer/confirmation.js?v=20261027-fixed-coupons-v2','/frontend/customer/orders-view.js?v=20261027-pricing-breakdown-v2','/frontend/customer/orders-data.js?v=orders3','/frontend/catalogue-media.js?v=20261029-semantic-media-v1','/frontend/customer/product-view.js?v=20261019-catalogue-premium-v1','/frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2','/notifications.js?v=n3','/frontend/customer/notifications.js?v=notif2','/frontend/customer/account-actions.js?v=notif3','/address-fix.js?v=20261009-address-fallback-safety-v5','/frontend/customer/address-geocode.js?v=20261021-guest-address-map-search-v3','/address-system-final.js?v=20261029-registration-prefill-v1','/frontend/customer/promotions.js?v=20261021-promo-natural-fit-v4','/frontend/customer/store-info.js?v=msg1','/frontend/customer/messages.js?v=msg1','/frontend/customer/profile.js?v=20261009-customer-profile-v2','/icons/icon-192-brand-v2.png?v=20261026-brand-v2','/icons/icon-512-brand-v2.png?v=20261026-brand-v2','/icons/icon-512-maskable-v2.png?v=20261026-brand-v2','/frontend/customer/pwa-install.js?v=20261029-nonintrusive-install-v2','/freshway-logo-master.webp?v=1','/freshway-logo-clean.svg?v=20261008-brand-v1'
];
const REQUIRED_SHELL=['/','/index.html'];

self.addEventListener('install',event=>{
event.waitUntil((async()=>{
const cache=await caches.open(CACHE);
const results=await Promise.all(APP_SHELL.map(async asset=>{
try {
const response=await fetch(new Request(asset,{cache:'no-cache'}));
if(!response.ok)throw new Error('HTTP '+response.status);
await cache.put(asset,response.clone());
return true;
} catch (error) {
console.error('SW shell asset failed:', asset, error);
return false;
}
}));
if(!REQUIRED_SHELL.every(asset=>results[APP_SHELL.indexOf(asset)])){
throw new Error('App shell cache failed.');
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
const destination=event.request.destination;
const isNavigation=event.request.mode==='navigate'||destination==='document';
const isStaticAsset=['script','style','image','font','manifest'].includes(destination);
if(!isNavigation&&!isStaticAsset)return;
event.respondWith((async () => {
const isLogo=url.pathname==='/freshway-logo-clean.svg';
const isVersionedCode = ['script','style'].includes(destination) && url.searchParams.has('v');
const request=isLogo?new Request(event.request,{cache:'reload'}):new Request(event.request,{cache:'no-store'});
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
const cached=await cache.match(event.request);
if (isVersionedCode) {
try{const response=await fetch(request);if(response.ok)cache.put(event.request,response.clone()).catch(()=>{});return response;}
catch{return cached||Response.error()}
}
const update=fetch(request).then(response => {
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
if(!event.data)return;
let data={};
try{
data=event.data.json();
}catch(_){
data={body:event.data.text()};
}
event.waitUntil((async()=>{
await self.registration.showNotification(data.title||'FreshWay',{
body:data.body||'You have a new FreshWay update.',
icon:data.icon||'/icons/icon-192-brand-v2.png?v=20261026-brand-v2',
badge:data.badge||'/icons/icon-192-brand-v2.png?v=20261026-brand-v2',
tag:data.tag||'freshway-notification',
data:{url:data.url||'/',...(data.data||{})}
});
const alert=data.data||{};
if(alert.audience!=='customer'||!alert.orderId)return;
const pages=await self.clients.matchAll({type:'window',includeUncontrolled:true});
await Promise.all(pages.map(async client=>{
try {
const page=new URL(client.url);
if(page.origin!==self.location.origin||page.pathname.startsWith('/admin/')||page.pathname==='/admin.html')return;
client.postMessage({
type:'freshway:order-updated',
audience:'customer',
orderId:String(alert.orderId),
eventType:String(alert.eventType||'order_update')
});
} catch (_) {}
}));
})());
});
self.addEventListener('notificationclick', event => {
event.notification.close();
const target=event.notification.data?.url||'/';
event.waitUntil((async () => {
const pages=await clients.matchAll({type:'window',includeUncontrolled:true});
const same = pages.find(client => {
try {
const page = new URL(client.url);
return page.origin === self.location.origin && !page.pathname.startsWith('/admin/') && page.pathname !== '/admin.html';
} catch (_) { return false; }
});
if(same){
await same.focus();
if ('navigate' in same) await same.navigate(target);
}else if(clients.openWindow){
await clients.openWindow(target);
}
})());
});
