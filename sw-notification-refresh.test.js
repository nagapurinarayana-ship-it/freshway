const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const handlers = {};
const sentNotifications = [];
const messages = [];
const cacheEntries = new Map();
let fetchCalls = 0;
let nextFetchResponse = null;
const cache = {
  match: async request => cacheEntries.get(typeof request === 'string' ? request : request.url) || null,
  put: async (request, response) => { cacheEntries.set(typeof request === 'string' ? request : request.url, response); },
  delete: async request => cacheEntries.delete(typeof request === 'string' ? request : request.url)
};
const cacheStorage = { open: async () => cache, keys: async () => [], delete: async () => true };
class MockRequest {
  constructor(input, init = {}) {
    const source = typeof input === 'string' ? { url: input, method: 'GET', destination: '', mode: 'cors' } : input;
    Object.assign(this, source, init);
    this.url = source.url;
    this.method = init.method || source.method || 'GET';
    this.destination = init.destination || source.destination || '';
    this.mode = init.mode || source.mode || 'cors';
  }
}
const pages = [
  { url: 'https://fwcoldpressed.in/orders', postMessage: value => messages.push({ page: 'customer', value }) },
  { url: 'https://fwcoldpressed.in/admin/', postMessage: value => messages.push({ page: 'owner', value }) },
  { url: 'https://other.example/orders', postMessage: value => messages.push({ page: 'other-origin', value }) }
];
const self = {
  location: { origin: 'https://fwcoldpressed.in' },
  registration: { showNotification: async (title, options) => sentNotifications.push({ title, options }) },
  clients: { matchAll: async () => pages },
  addEventListener: (name, callback) => { handlers[name] = callback; },
  skipWaiting: () => Promise.resolve()
};
vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), {
  self,
  caches: cacheStorage,
  URL,
  Request: MockRequest,
  console,
  fetch: async () => {
    fetchCalls++;
    if (nextFetchResponse) return nextFetchResponse;
    throw new Error('fetch is not expected for this event');
  }
});

async function dispatchPush(payload) {
  let work;
  handlers.push({
    data: { json: () => payload },
    waitUntil: promise => { work = promise; }
  });
  await work;
}

(async () => {
  await dispatchPush({
    title: 'FreshWay payment update',
    body: 'Payment has been collected.',
    data: { audience: 'customer', orderId: 'FW-1', eventType: 'payment_changed' }
  });
  assert.equal(sentNotifications.length, 1, 'push still displays the notification');
  assert.equal(messages.length, 1, 'only customer app tabs on this origin receive refresh messages');
  assert.equal(messages[0].page, 'customer');
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].value)), {
    type: 'freshway:order-updated',
    audience: 'customer',
    orderId: 'FW-1',
    eventType: 'payment_changed'
  });

  await dispatchPush({
    title: 'FreshWay marketing message',
    body: 'General announcement',
    data: { audience: 'customer' }
  });
  assert.equal(messages.length, 1, 'non-order pushes do not trigger order refresh');

  const app = fs.readFileSync('app.js', 'utf8');
  const index = fs.readFileSync('index.html', 'utf8');
  assert.match(app, /freshway:order-updated/);
  assert.match(app, /customerOrderData\.load\(\)/);
  assert.match(index, /app\.js\?v=102/);
  assert.match(index, /frontend\/customer\/orders-data\.js\?v=orders3/);
  assert.match(index, /frontend\/customer\/messages\.js\?v=msg1/);
  assert.match(index, /frontend\/customer\/store-info\.js\?v=msg1/);
  assert.match(index, /frontend\/customer\/cart-bar\.js\?v=20261029-info-pages-cart-visibility-v2/);
  const assetUrl = 'https://fwcoldpressed.in/frontend/customer/navigation.js?v=20261028-nav-restore-v2';
  const oldResponse = { ok: true, body: 'legacy', clone() { return { ...this }; } };
  const freshResponse = { ok: true, body: 'current', clone() { return { ...this }; } };
  cacheEntries.set(assetUrl, oldResponse);
  nextFetchResponse = freshResponse;
  const fetchRequest = { url: assetUrl, method: 'GET', destination: 'script', mode: 'cors' };
  let responsePromise;
  handlers.fetch({
    request: fetchRequest,
    respondWith: promise => { responsePromise = promise; },
    waitUntil: promise => { void promise; }
  });
  const returnedAsset = await responsePromise;
  assert.equal(fetchCalls, 1, 'versioned JavaScript must attempt a fresh network response even when an older cached copy exists');
  assert.equal(returnedAsset.body, 'current', 'the browser must receive the current JavaScript instead of a stale cache hit');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await cache.match(fetchRequest)).body, 'current', 'the cache should be updated to the current asset');
  console.log('customer push refresh and network-first versioned asset tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
