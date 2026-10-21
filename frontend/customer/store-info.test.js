const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/customer/store-info.js', 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const storeInfo = sandbox.window.FreshWayCustomerStoreInfo;

assert.equal(typeof storeInfo.validShopCoordinates, 'function');
assert.equal(storeInfo.validShopCoordinates(17.6, 79.1), true);
assert.equal(storeInfo.validShopCoordinates('17.6', '79.1'), true);
assert.equal(storeInfo.validShopCoordinates(91, 79.1), false);
assert.equal(storeInfo.validShopCoordinates(0, 0), false);
assert.equal(storeInfo.validShopCoordinates(null, 79.1), false);

const directions = new URL(storeInfo.mapHref('Mancherial', 17.6, 79.1));
assert.equal(directions.origin, 'https://www.google.com');
assert.equal(directions.pathname, '/maps/dir/');
assert.equal(directions.searchParams.get('api'), '1');
assert.equal(directions.searchParams.get('destination'), '17.6,79.1');

const fallback = new URL(storeInfo.mapHref('Mancherial', null, null));
assert.equal(fallback.pathname, '/maps/search/');
assert.equal(fallback.searchParams.get('query'), 'Mancherial');
assert.equal(new URL(storeInfo.mapHref('Mancherial', 999, 79.1)).searchParams.get('query'), 'Mancherial');
assert.equal(storeInfo.mapHref('', null, null), '');

console.log('Customer business map pin navigation and address fallback tests passed');
