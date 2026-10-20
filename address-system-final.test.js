const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('address-system-final.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

assert.match(source, /function checkoutAddressIssue\(address\)/);
for (const required of ['recipient name','delivery contact number','house\/flat number','area\/street','city','PIN code']) {
  assert.ok(source.includes(required), 'checkout address completeness must check ' + required);
}
assert.match(source, /id="fwCheckoutCompleteAddress">Complete address/);
assert.match(source, /openCheckoutAddressManager\(selected && selected\.id\)/);
assert.match(source, /buildEditor\(editAddressId\)/);
assert.match(source, /modalOrigin === 'checkout' && returnedAddress/);
assert.match(source, /hideModal\(\);\s*syncCheckout\(\);/);
assert.match(source, /isDefault: editingAddress \? !!editingAddress\.isDefault : addresses\.length === 0/);
assert.ok(index.includes('address-system-final.js?v=20261020-checkout-address-completion-v1'), 'HTML must load the updated address module');
assert.ok(sw.includes('/address-system-final.js?v=20261020-checkout-address-completion-v1'), 'service worker must cache the updated address module');
assert.match(sw, /freshway-v49/);
console.log('checkout incomplete/default address completion contract OK');
