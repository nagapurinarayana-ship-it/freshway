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
      inventory: [
        {
          id: 'oil-d1',
          name: 'Groundnut Oil',
          unit: '5 litre can',
          stock_managed: 1,
          on_hand: onHand,
          reserved_qty: 2,
          low_stock_threshold: 5
        },
        {
          id: 'hidden-oil',
          name: 'Archived Groundnut Oil',
          unit: '1 litre bottle',
          stock_managed: 1,
          on_hand: 4,
          reserved_qty: 0,
          low_stock_threshold: 2
        }
      ]
    }
  };
}

async function run() {
  const availabilityInput = { checked: true, disabled: false };
  const priceInput = { value: '299', disabled: false };
  const stockInput = { dataset: { inventoryProduct: 'oil-d1' }, value: '24', disabled: false };
  const hiddenStockInput = { dataset: { inventoryProduct: 'hidden-oil' }, value: '4', disabled: false };
  const status = { textContent: '' };
  const searchInput = { value: '' };
  const filterEmpty = { hidden: true };
  const saveButton = { disabled: false, textContent: '' };
  const controls = [availabilityInput, priceInput, stockInput, hiddenStockInput];
  const root = {
    innerHTML: '',
    listeners: new Map(),
    querySelector(selector) {
      if (selector === '[data-catalogue-available="oil-d1"]') return availabilityInput;
      if (selector === '[data-catalogue-price="oil-d1"]') return priceInput;
      if (selector === '[data-inventory-product="oil-d1"]') return stockInput;
      if (selector === '[data-inventory-product="hidden-oil"]') return hiddenStockInput;
      if (selector === '[data-store-management-status]') return status;
      if (selector === '[data-store-product-search]') return searchInput;
      if (selector === '[data-store-filter-empty]') return filterEmpty;
      if (selector === '[data-save-store-management]') return saveButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-inventory-product]') return [stockInput, hiddenStockInput];
      if (selector === '[data-catalogue-available],[data-catalogue-price],[data-inventory-product]') return controls;
      if (selector === '[data-managed-product]' || selector === '[data-stock-filter]') return [];
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
  let failNextInventoryPatch = false;
  let holdCataloguePatch = false;
  const cataloguePatchGate = deferred();
  let failNextStoreTwoInventoryRead = false;
  let assertControlsDisabledDuringSave = false;

  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method, body });
    if (url === '/api/admin/delivery/stores' && method === 'GET') return response({ stores });
    const match = String(url).match(/^\/api\/admin\/delivery\/stores\/([^/]+)\/(catalogue|inventory)$/);
    assert.ok(match, 'unexpected Owner store API request: ' + url);
    const [, storeId, resource] = match;
    if (method === 'PATCH') {
      if (resource === 'catalogue' && holdCataloguePatch) {
        holdCataloguePatch = false;
        await cataloguePatchGate.promise;
      }
      if (assertControlsDisabledDuringSave) {
        assert.ok(controls.every(control => control.disabled), 'editable product fields must be disabled during save');
      }
      if (resource === 'inventory' && failNextInventoryPatch) {
        failNextInventoryPatch = false;
        return response({ error: 'Inventory temporarily unavailable' }, 503);
      }
      if (resource === 'catalogue') {
        for (const item of body.items) {
          const current = fixtures[storeId].catalogue.items.find(row => row.id === item.productId);
          if (current) {
            current.isAvailable = item.isAvailable;
            current.priceOverride = item.priceOverride;
            current.storePrice = item.priceOverride == null ? current.centralPrice : item.priceOverride;
          }
        }
      } else {
        for (const item of body.items) {
          const current = fixtures[storeId].inventory.inventory.find(row => row.id === item.productId);
          if (current) current.on_hand = item.stockQuantity;
        }
      }
      return response({ ok: true });
    }
    if (method === 'GET' && storeId === 'store-two' && resource === 'inventory' && failNextStoreTwoInventoryRead) {
      failNextStoreTwoInventoryRead = false;
      return response({ error: 'Store inventory temporarily unavailable' }, 503);
    }
    if (delayed[storeId + ':' + resource]) return delayed[storeId + ':' + resource].promise;
    return response(fixtures[storeId][resource]);
  };

  let confirmResult = false;
  const confirmMessages = [];
  const context = {
    document: { querySelector: selector => selector === '#storeManagement' ? root : null },
    window: { confirm: message => { confirmMessages.push(message); return confirmResult; } },
    fetch,
    CSS: { escape: value => String(value) },
    console
  };
  vm.runInNewContext(source, context, { filename: 'store-management.js' });
  const manager = context.window.FreshWayOwnerStoreManagement;
  assert.ok(manager && typeof manager.open === 'function', 'Owner store manager must expose its workspace opener');

  await manager.load();
  assert.ok(root.innerHTML.includes('data-manage-store="store-one"'));
  assert.ok(root.innerHTML.includes('data-manage-store="store-two"'));
  assert.ok(root.innerHTML.includes('data-store-id="store-two"'));
  assert.doesNotMatch(root.innerHTML, /data-edit-inventory=|data-edit-catalogue=/);
  const click = root.listeners.get('click');

  // If an editing form is missing during a render edge, fail safely rather
  // than assuming the draft is clean and dropping it.
  await click({ target: { closest: selector => selector.includes('[data-edit-store]') ? { dataset: { editStore: 'store-one' } } : null } });
  confirmResult = false;
  assert.equal(manager.beforeNavigate(), false, 'an active Store form must be treated as dirty when its DOM is unexpectedly unavailable');
  await manager.load();

  await click({ target: { closest: selector => selector.includes('[data-manage-store]') ? { dataset: { manageStore: 'store-two' } } : null } });
  assert.ok(root.innerHTML.includes('<h2>Store Two</h2>'));
  assert.ok(!root.innerHTML.includes('data-manage-store='), 'the store list must be hidden while editing');
  assert.ok(root.innerHTML.includes('<strong data-store-summary-products>2</strong>'), 'product summary must count products, not rendered HTML characters');
  assert.ok(root.innerHTML.includes('fw-managed-inventory-only'), 'hidden central-catalogue stock must remain manageable');
  assert.ok(!root.innerHTML.includes('Reserved: 2 · Available:'), 'stock details must not be duplicated');
  assert.ok(root.innerHTML.includes('aria-pressed="true" data-stock-filter="all"'));
  assert.equal(manager.historyContext().storeId, 'store-two', 'the active Store context must be available to Owner history restoration');
  assert.equal(manager.beforeNavigate(), true, 'a clean Store workspace must not require confirmation');
  priceInput.value = '300';
  confirmResult = false;
  assert.equal(manager.beforeNavigate(), false, 'choosing Stay must block navigation when a Store price is dirty');
  assert.match(confirmMessages.at(-1), /unsaved Store changes/i);
  confirmResult = true;
  assert.equal(manager.beforeNavigate(), true, 'choosing Leave must explicitly allow discarding Store edits');
  priceInput.value = '299';

  const oldStoreRequest = manager.open('store-one');
  await Promise.resolve();
  assert.ok(root.innerHTML.includes('Loading products and stock…'), 'opening a store must show an honest loading state');
  assert.ok(root.innerHTML.includes('data-store-summary-products>—</strong>'), 'product count must not show a false zero while loading');
  assert.ok(calls.some(call => call.url === '/api/admin/delivery/stores/store-one/inventory'));
  await manager.open('store-two');
  assert.ok(root.innerHTML.includes('data-inventory-product="oil-d1" value="24"'));
  assert.ok(root.innerHTML.includes('data-catalogue-price="oil-d1" value="299"'));
  delayed['store-one:catalogue'].resolve(response(fixtures['store-one'].catalogue));
  delayed['store-one:inventory'].resolve(response(fixtures['store-one'].inventory));
  await oldStoreRequest;
  assert.ok(root.innerHTML.includes('<h2>Store Two</h2>'), 'late Store One results must not replace Store Two');
  assert.ok(root.innerHTML.includes('data-inventory-product="oil-d1" value="24"'));
  assert.ok(root.innerHTML.includes('data-catalogue-price="oil-d1" value="299"'));

  priceInput.value = '309';
  stockInput.value = '25';
  hiddenStockInput.value = '6';
  await click({ target: { closest: selector => selector.includes('[data-save-store-management]') ? saveButton : null } });
  const firstPatches = calls.filter(call => call.method === 'PATCH');
  assert.deepEqual(firstPatches.slice(0, 2).map(call => call.url).sort(), [
    '/api/admin/delivery/stores/store-two/catalogue',
    '/api/admin/delivery/stores/store-two/inventory'
  ].sort());
  assert.equal(firstPatches.find(call => call.url.endsWith('/catalogue')).body.items[0].priceOverride, 309);
  const firstInventoryItems = firstPatches.find(call => call.url.endsWith('/inventory')).body.items;
  assert.equal(firstInventoryItems.find(item => item.productId === 'oil-d1').stockQuantity, 25);
  assert.equal(firstInventoryItems.find(item => item.productId === 'hidden-oil').stockQuantity, 6);
  assert.ok(root.innerHTML.includes('value="309"'));
  assert.ok(root.innerHTML.includes('value="25"'));

  priceInput.value = '319';
  stockInput.value = '26';
  hiddenStockInput.value = '7';
  const viewBeforePartialSave = root.innerHTML;
  failNextInventoryPatch = true;
  assertControlsDisabledDuringSave = true;
  await click({ target: { closest: selector => selector.includes('[data-save-store-management]') ? saveButton : null } });
  assertControlsDisabledDuringSave = false;
  assert.equal(root.innerHTML, viewBeforePartialSave, 'partial failure must not rerender and discard edited values');
  assert.equal(priceInput.value, '319');
  assert.equal(stockInput.value, '26');
  assert.equal(hiddenStockInput.value, '7');
  assert.ok(controls.every(control => !control.disabled));
  assert.equal(saveButton.disabled, false);
  assert.match(status.textContent, /Prices and availability saved/);
  assert.match(status.textContent, /Inventory: Inventory temporarily unavailable/);
  assert.match(status.textContent, /edits are still on screen/);

  await click({ target: { closest: selector => selector.includes('[data-save-store-management]') ? saveButton : null } });
  assert.ok(root.innerHTML.includes('value="319"'));
  assert.ok(root.innerHTML.includes('value="26"'));
  assert.ok(root.innerHTML.includes('value="7"'));

  // Navigation remains blocked while a server save is still pending, even
  // when its input values currently match the visible draft.
  priceInput.value = '329';
  holdCataloguePatch = true;
  const confirmCountBeforeSave = confirmMessages.length;
  const saving = click({ target: { closest: selector => selector.includes('[data-save-store-management]') ? saveButton : null } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.beforeNavigate(), false, 'navigation must not interrupt an in-flight Store save');
  assert.equal(confirmMessages.length, confirmCountBeforeSave, 'an in-flight save should be blocked without a discard prompt');
  assert.match(status.textContent, /save is still in progress/i);
  cataloguePatchGate.resolve();
  await saving;
  assert.ok(root.innerHTML.includes('value="329"'));

  const allPatches = calls.filter(call => call.method === 'PATCH');
  assert.ok(allPatches.every(call => call.url.includes('/stores/store-two/')), 'every write must stay scoped to Store Two');
  assert.equal(allPatches.length, 8, 'success, partial failure, retry and in-flight save each issue two scoped writes');

  await manager.load();
  assert.ok(root.innerHTML.includes('data-manage-store="store-one"'));
  assert.ok(root.innerHTML.includes('data-manage-store="store-two"'));
  assert.ok(!root.innerHTML.includes('fw-store-management-panel'));
  failNextStoreTwoInventoryRead = true;
  await manager.open('store-two');
  assert.ok(root.innerHTML.includes('Prices and inventory could not be loaded for this store.'), 'a failed read must not be presented as an empty catalogue');
  assert.ok(root.innerHTML.includes('data-retry-store-management'), 'a failed store read must have an in-place retry');
  await click({ target: { closest: selector => selector.includes('[data-retry-store-management]') ? {} : null } });
  assert.ok(root.innerHTML.includes('value="329"'), 'retry must successfully reload the latest saved Store price');
  assert.ok(root.innerHTML.includes('value="26"'));

  // Store One fixture has 7 on-hand, 2 reserved and a threshold of 5:
  // only 5 units are available, so the Owner UI must flag it as low stock.
  // The inventory-only fixture has 4 available against a threshold of 2
  // and must not inflate the low-stock count.
  await manager.open('store-one');
  assert.ok(root.innerHTML.includes('<strong data-store-summary-low>1</strong>'),
    'low-stock summary must count available quantity after reservations, not raw on-hand stock');
  assert.ok(root.innerHTML.includes('data-stock-state="low"'),
    'a product at its low-stock threshold must receive the low stock state');
  assert.ok(root.innerHTML.includes('class="fw-stock-pill fw-stock-low"'),
    'the Owner inventory card must render the Low stock indicator');
  assert.equal(manager.historyContext().storeId, 'store-one');

  console.log('Owner store workspace: store isolation, inventory-only products, loading and retry states, low-stock thresholds after reservations, summaries, accessible filters, combined save, partial-save recovery and refresh OK');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
