const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/admin/store-management.js', 'utf8');

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(storeId, name, price, onHand) {
  return {
    catalogue: {
      items: [{
        id: 'oil-d1',
        name: 'Groundnut Oil',
        unit: '5 litre can',
        centralPrice: 189,
        priceOverride: price,
        storePrice: price,
        isAvailable: true,
        stockManaged: true,
        onHand,
        reservedQty: 2,
        categoryName: 'Oils'
      }]
    },
    inventory: {
      store: { id: storeId, name, is_active: 1 },
      inventory: [{
        id: 'oil-d1',
        name: 'Groundnut Oil',
        unit: '5 litre can',
        stock_managed: 1,
        on_hand: onHand,
        reserved_qty: 2,
        low_stock_threshold: 5
      }]
    }
  };
}

async function run() {
  const root = {
    innerHTML: '',
    listeners: new Map(),
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '[data-inventory-product]') {
        return [{ dataset: { inventoryProduct: 'oil-d1' }, value: '25' }];
      }
      return [];
    },
    addEventListener(name, callback) { this.listeners.set(name, callback); }
  };
  const stores = [
    { id: 'store-one', name: 'Store One', address: 'First address', service_radius_km: 5, is_active: 1 },
    { id: 'store-two', name: 'Store Two', address: 'Second address', service_radius_km: 5, is_active: 1 }
  ];
  const fixtures = {
    'store-one': fixture('store-one', 'Store One', 179, 7),
    'store-two': fixture('store-two', 'Store Two', 299, 24)
  };
  const delayed = {
    'store-one:catalogue': deferred(),
    'store-one:inventory': deferred()
  };
  const calls = [];
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
    if (url === '/api/admin/delivery/stores' && method === 'GET') return response({ stores });
    const match = String(url).match(/^\/api\/admin\/delivery\/stores\/([^/]+)\/(catalogue|inventory)$/);
    assert.ok(match, 'unexpected Owner store API request: ' + url);
    const [, storeId, resource] = match;
    if (method === 'PATCH') return response({ ok: true });
    if (delayed[storeId + ':' + resource]) return delayed[storeId + ':' + resource].promise;
    return response(fixtures[storeId][resource]);
  };
  const context = {
    document: {
      querySelector(selector) {
        if (selector === '#storeManagement') return root;
        return null;
      }
    },
    window: {},
    fetch,
    CSS: { escape: value => String(value) },
    console
  };
  vm.runInNewContext(source, context, { filename: 'store-management.js' });
  const manager = context.window.FreshWayOwnerStoreManagement;
  assert.ok(manager && typeof manager.open === 'function', 'Owner store manager must expose its workspace opener for integration');

  await manager.load();
  assert.ok(root.innerHTML.includes('data-manage-store="store-one"'), 'each store card must have its own management button');
  assert.ok(root.innerHTML.includes('data-manage-store="store-two"'), 'second store must have a distinct management button');

  // Start Store One, then switch to Store Two before Store One's two API reads finish.
  const oldStoreRequest = manager.open('store-one');
  await Promise.resolve();
  assert.ok(calls.some(call => call.url === '/api/admin/delivery/stores/store-one/inventory'), 'Store One must request its own inventory URL');
  await manager.open('store-two');
  assert.ok(root.innerHTML.includes('<h2>Store Two</h2>'), 'the selected Store Two workspace must be rendered');
  assert.ok(root.innerHTML.includes('data-inventory-product="oil-d1" value="24"'), 'Store Two must show its own on-hand quantity');
  assert.ok(root.innerHTML.includes('data-catalogue-price="oil-d1" value="299"'), 'Store Two must show its own selling-price override');

  delayed['store-one:catalogue'].resolve(response(fixtures['store-one'].catalogue));
  delayed['store-one:inventory'].resolve(response(fixtures['store-one'].inventory));
  await oldStoreRequest;
  assert.ok(root.innerHTML.includes('<h2>Store Two</h2>'), 'a late Store One response must not replace the selected Store Two workspace');
  assert.ok(root.innerHTML.includes('data-inventory-product="oil-d1" value="24"'), 'late responses must not overwrite Store Two stock');
  assert.ok(root.innerHTML.includes('data-catalogue-price="oil-d1" value="299"'), 'late responses must not overwrite Store Two pricing');

  // One Save action must write both settings to the selected Store Two endpoints.
  root.querySelector = selector => {
    if (selector === '[data-catalogue-available="oil-d1"]') return { checked: true };
    if (selector === '[data-catalogue-price="oil-d1"]') return { value: '309' };
    return null;
  };
  const click = root.listeners.get('click');
  const saveButton = { disabled: false, textContent: '' };
  await click({
    target: {
      closest(selector) {
        return selector.includes('[data-save-store-management]') ? saveButton : null;
      }
    }
  });
  const patches = calls.filter(call => call.method === 'PATCH');
  assert.deepEqual(patches.map(call => call.url).sort(), [
    '/api/admin/delivery/stores/store-two/catalogue',
    '/api/admin/delivery/stores/store-two/inventory'
  ].sort(), 'combined Save must write price and inventory to the selected store only');
  const cataloguePatch = patches.find(call => call.url.endsWith('/catalogue'));
  const inventoryPatch = patches.find(call => call.url.endsWith('/inventory'));
  assert.equal(cataloguePatch.body.items[0].priceOverride, 309);
  assert.equal(inventoryPatch.body.items[0].stockQuantity, 25);
  assert.ok(root.innerHTML.includes('<h2>Store Two</h2>'), 'save refresh must keep the same store selected');

  console.log('Owner store-scoped combined pricing/inventory workspace and stale-response regression OK');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
