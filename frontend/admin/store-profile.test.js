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
assert.ok(html.includes('frontend/admin/store-profile.js?v=20261021-free-osm-picker-v1'), 'Owner must load the free OpenStreetMap picker module');
assert.ok(source.includes('loadLeaflet'), 'Free OpenStreetMap picker must remain available');
assert.ok(!source.includes('loadGoogleMaps'), 'Owner picker must not require a paid Google Maps API');
assert.ok(!source.includes("api('/admin/maps/config')"), 'Owner picker must not depend on a paid map provider config endpoint');
assert.ok(ownerSw.includes('frontend/admin/store-profile.js?v=20261021-free-osm-picker-v1'), 'Owner PWA shell must cache the free map-picker module');
assert.ok(source.includes('loadLeaflet'), 'OpenStreetMap picker must be available without paid map APIs');
assert.ok(ownerSw.includes("const CACHE = 'fw-owner-v19'"), 'Owner PWA cache must be refreshed for the new picker');

assert.match(css, /\.shop-location-map\s*\{/);
assert.match(source, /The saved pin stays unchanged until you do/);
assert.match(source, /these changes apply/i);
console.log('Owner shop pin validation, free OpenStreetMap picker, address separation, and PWA asset contracts passed');
