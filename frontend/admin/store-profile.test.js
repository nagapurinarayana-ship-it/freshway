const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('admin.html', 'utf8');
const css = fs.readFileSync('admin.css', 'utf8');
const source = fs.readFileSync('frontend/admin/store-profile.js', 'utf8');
const ownerSw = fs.readFileSync('admin/sw.js', 'utf8');
const elements = new Map();
const fieldValues = {
  storeName: 'FreshWay',
  storeAddress: 'Mancherial',
  storeHours: 'Weekdays',
  storeDeliveryInfo: 'Local delivery'
};
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      value: fieldValues[id] || '',
      dataset: {},
      handlers: {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      replaceChildren() {},
      appendChild() {},
      remove() {},
      set textContent(value) { this._textContent = String(value); },
      get textContent() { return this._textContent || ''; }
    });
  }
  return elements.get(id);
}
const sandbox = {
  window: {},
  document: {
    getElementById: element,
    querySelector() { return null; },
    createElement(tag) { return element('created-' + tag + '-' + elements.size); },
    head: { appendChild() {} }
  },
  URLSearchParams,
  setTimeout
};
vm.runInNewContext(source, sandbox);
const profile = sandbox.window.FreshWayOwnerStoreProfile;

assert.equal(typeof profile.validPin, 'function');
const valid = profile.validPin('17.6082', '79.1091');
assert.equal(valid.latitude, 17.6082);
assert.equal(valid.longitude, 79.1091);
assert.equal(profile.validPin(91, 79.1), null);
assert.equal(profile.validPin(17.6, 181), null);
assert.equal(profile.validPin(0, 0), null);
assert.equal(profile.validPin('', 79.1), null);

const collected = profile.collect();
assert.equal(collected.address, 'Mancherial', 'business address text remains independent from map coordinates');
assert.equal(collected.shopLatitude, null, 'no coordinate is invented for the existing town-only address');
assert.equal(collected.shopLongitude, null);
assert.equal(collected.businessHours, 'Weekdays');
assert.equal(collected.deliveryInfo, 'Local delivery');

assert.ok(html.includes('id="storeAddress"'), 'existing business address field must remain');
assert.ok(html.includes('id="storeLocationMap"'), 'Owner settings must expose a dedicated map picker');
assert.ok(html.includes('id="storeLocationSearchButton"'), 'Owner must be able to search for the shop');
assert.ok(html.includes('id="storeLocationClearButton"'), 'Owner must be able to clear an incorrect pin');
assert.ok(html.includes('id="storeLocationSaveButton"'), 'Owner must be able to explicitly save and confirm a selected shop pin');
assert.match(html, /id="storeAddress"[^>]*required/, 'the business address must be mandatory for store setup and commercial invoices');
assert.ok(html.includes('frontend/admin/store-profile.js?v=20261024-response-guard-v2'), 'Owner must load the free OpenStreetMap picker module');
assert.ok(source.includes('loadLeaflet'), 'Free OpenStreetMap picker must remain available');
assert.ok(!source.includes('loadGoogleMaps'), 'Owner picker must not require a paid Google Maps API');
assert.ok(!source.includes("api('/admin/maps/config')"), 'Owner picker must not depend on a paid map provider config endpoint');
assert.ok(ownerSw.includes('frontend/admin/store-profile.js?v=20261024-response-guard-v2'), 'Owner PWA shell must cache the free map-picker module');
assert.ok(source.includes('loadLeaflet'), 'OpenStreetMap picker must be available without paid map APIs');
assert.ok(ownerSw.includes("const CACHE = 'fw-owner-v51'"), 'Owner PWA cache must be refreshed for the new picker');

assert.match(css, /\.shop-location-map\s*\{/);
assert.match(source, /The saved pin stays unchanged until you do/);
assert.match(source, /these changes apply/i);
async function checkProfileLoadResponseGuard() {
  const addressField = element('storeAddress');
  const nameField = element('storeName');
  nameField.value = 'FreshWay';
  addressField.value = 'Mancherial, Telangana';

  for (const response of [
    {},
    { storeProfile: null },
    { storeProfile: {} },
    { storeProfile: { storeName: 'FreshWay', address: 'Mancherial' } },
    { storeProfile: {
      storeName: null, about: '', phone: '', whatsapp: '', email: '',
      address: null, businessHours: '', deliveryInfo: '', shareTitle: '', shareDescription: ''
    } }
  ]) {
    await assert.rejects(
      profile.load({ api: async () => response }),
      /incomplete Store Profile/,
      'an incomplete response must be rejected before it overwrites form fields'
    );
    assert.equal(nameField.value, 'FreshWay', 'failed load must not erase the current store name');
    assert.equal(addressField.value, 'Mancherial, Telangana', 'failed load must not erase the current business address');
  }

  // A malformed PATCH response must not erase unsaved edits either.
  element('storeAbout').value = 'Unsaved description that must survive a bad save response';
  for (const response of [
    null,
    '<html>Not JSON</html>',
    { storeProfile: [] },
    { storeProfile: { storeName: 'FreshWay', address: 'Mancherial' } }
  ]) {
    await assert.rejects(
      profile.save({ api: async () => response }),
      /incomplete Store Profile/,
      'a malformed save response must be rejected before applying server data'
    );
    assert.equal(nameField.value, 'FreshWay', 'failed save must preserve the store name');
    assert.equal(addressField.value, 'Mancherial, Telangana', 'failed save must preserve the business address');
    assert.equal(element('storeAbout').value, 'Unsaved description that must survive a bad save response',
      'failed save must preserve unsaved edits');
  }

  const validProfile = {
    storeName: 'FreshWay',
    about: 'Cold-pressed oils and rice',
    phone: '9999999999',
    whatsapp: '9999999999',
    email: 'store@example.test',
    address: 'Mancherial, Telangana',
    shopLatitude: null,
    shopLongitude: null,
    businessHours: 'Weekdays',
    deliveryInfo: 'Local delivery',
    shareTitle: 'FreshWay',
    shareDescription: 'Fresh essentials delivered locally'
  };
  await profile.load({ api: async () => ({ storeProfile: validProfile }) });
  assert.equal(nameField.value, 'FreshWay');
  assert.equal(addressField.value, 'Mancherial, Telangana');
  assert.equal(element('storeAbout').value, 'Cold-pressed oils and rice');
  assert.equal(profile.hasUnsavedChanges(), false, 'a confirmed server load starts clean');
  element('storeAbout').value = 'Edited but not saved';
  element('storeAbout').handlers.input();
  assert.equal(profile.hasUnsavedChanges(), true, 'field edits are tracked as unsaved');
  await profile.load({ api: async () => ({ storeProfile: validProfile }) });
  assert.equal(element('storeAbout').value, 'Edited but not saved', 'revisiting Settings must not overwrite unsaved Store Profile edits');
  assert.equal(profile.hasUnsavedChanges(), true, 'preserved edits remain visibly unsaved');
  await profile.save({ api: async (_path, options) => ({ storeProfile: { ...validProfile, about: JSON.parse(options.body).about } }) });
  assert.equal(element('storeAbout').value, 'Edited but not saved');
  assert.equal(profile.hasUnsavedChanges(), false, 'server-confirmed save clears the unsaved flag');
  console.log('Owner store profile response validation and safe form loading passed');
}

checkProfileLoadResponseGuard().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
