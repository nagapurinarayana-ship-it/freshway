const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const handlers = {};
const sentNotifications = [];
const messages = [];
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
  caches: {},
  URL,
  Request,
  console,
  fetch: async () => { throw new Error('fetch is not expected in this test'); }
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
  assert.match(index, /app\.js\?v=20261027-checkout-ux-v2/);
  assert.match(index, /frontend\/customer\/orders-data\.js\?v=20261027-checkout-ux-v2/);
  assert.match(index, /frontend\/customer\/cart-bar\.js\?v=20261027-checkout-ux-v2/);
  console.log('customer push-to-order-refresh tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
