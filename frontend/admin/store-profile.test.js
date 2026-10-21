const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('admin.html', 'utf8');
const css = fs.readFileSync('admin.css', 'utf8');
const source = fs.readFileSync('frontend/admin/store-profile.js', 'utf8');
const ownerSw = fs.readFileSync('admin/sw.js', 'utf8');
const adminAuth = fs.readFileSync('worker/src/admin-auth.js', 'utf8');
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
assert.ok(html.includes('frontend/admin/store-profile.js?v=20261021-google-maps-picker-v1'), 'Owner must load the refreshed Google Maps picker module');
assert.ok(source.includes('loadGoogleMaps'), 'Google Maps should be supported when the browser key is configured');
assert.ok(source.includes('AutocompleteSuggestion'), 'Google Places suggestions should be used for shop lookup where available');
assert.ok(source.includes('loadLeaflet'), 'OpenStreetMap backup must remain available when Google Maps is not configured or fails');
assert.ok(source.includes("api('/admin/maps/config')"), 'Owner picker must read its maps provider configuration from the authenticated API');
assert.ok(adminAuth.includes("'/api/admin/maps/config'"), 'Worker must expose maps config only inside the authenticated admin route');
assert.ok(adminAuth.includes('env.GOOGLE_MAPS_BROWSER_API_KEY'), 'Maps browser key must come from Worker environment, never hard-coded in frontend files');
assert.ok(ownerSw.includes("const CACHE = 'fw-owner-v17'"), 'Owner PWA cache must be refreshed for the new picker');
assert.ok(ownerSw.includes('frontend/admin/store-profile.js?v=20261021-google-maps-picker-v1'), 'Owner PWA shell must cache the new map-picker module');

assert.match(css, /\.shop-location-map\s*\{/);
assert.match(source, /The saved pin stays unchanged until you do/);
assert.match(source, /these changes apply/i);
console.log('Owner shop pin validation, Google Maps integration/fallback, address separation, and PWA asset contracts passed');
