const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('address-system-final.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const css = fs.readFileSync('frontend/customer/address-book.css', 'utf8');
const notifications = fs.readFileSync('notifications.js', 'utf8');

assert.match(source, /function checkoutAddressIssue\(address\)/);
assert.match(source, /deliveryPhone: normalizePhone\(rawPhone\) \|\| rawPhone/,
  'saved +91 phone must be normalized at the shared address boundary');
assert.match(source, /const normalizedFieldPhone = normalizePhone\(phoneField && phoneField\.value\)/,
  'save must normalize the visible phone input before reading the payload');
assert.match(source, /pair\[1\] === 'deliveryPhone'[\s\S]*?normalizePhone\(source\[pair\[1\]\]\)/,
  'saved +91 phone must be normalized when prefilled into the editor');
assert.match(notifications, /async function ensureAuthenticated\(phone\)[\s\S]*?const normalized=normalizeAuthPhone\(phone\)/,
  'authentication must normalize +91 numbers before 10-digit validation');
assert.match(source, /phoneField\.addEventListener\('blur'[\s\S]*?normalizePhone\(phoneField\.value\)/, 'pasted +91 phone must normalize when the user leaves the field');
for (const required of ['recipient name','delivery contact number','house\/flat number','area\/street','city','PIN code']) {
  assert.ok(source.includes(required), 'checkout address completeness must check ' + required);
}
assert.match(source, /id="fwCheckoutCompleteAddress">Complete address/);
assert.match(source, /openCheckoutAddressManager\(selected && selected\.id\)/);
assert.match(source, /function editCheckoutAddress\(\)[\s\S]*?openCheckoutAddressManager\(selected \? selected\.id : null\)/);
assert.match(source, /if \(target\.closest\('#fwCheckoutChangeAddress'\)\)[\s\S]*?editCheckoutAddress\(\)/);
assert.match(source, /buildEditor\(editAddressId\)/);
assert.match(source, /modalOrigin === 'checkout' && returnedAddress/);
assert.match(source, /hideModal\(\);\s*syncCheckout\(\);/);
assert.match(source, /isDefault: editingAddress \? !!editingAddress\.isDefault : addresses\.length === 0/);
assert.match(source, /const preserve = labelFields\.map/);
assert.match(source, /addressLoadError = error\.message/);
assert.match(source, /id="addressModalTitle" tabindex="-1"/);
assert.match(source, /modalReturnFocus/);
assert.ok(index.includes('address-system-final.js?v=20261020-phone-boundary-fix-v2'), 'HTML must load the current address module');
assert.ok(sw.includes('/address-system-final.js?v=20261020-phone-boundary-fix-v2'), 'service worker must cache the current address module');
assert.ok(index.includes('address-book.css?v=20261020-address-ui-hardening-v2'), 'HTML must load the current address CSS');
assert.ok(sw.includes('/frontend/customer/address-book.css?v=20261020-address-ui-hardening-v2'), 'service worker must cache the current address CSS');
assert.ok(index.includes('notifications.js?v=20261020-normalized-auth-phone-v2'), 'HTML must load the auth phone normalizer');
assert.ok(sw.includes('/notifications.js?v=20261020-normalized-auth-phone-v2'), 'service worker must cache the auth phone normalizer');
assert.match(sw, /freshway-v53/);
assert.match(css, /#toast\s*\{[^}]*white-space:\s*normal/s);
assert.match(css, /\.fw-address-incomplete\s*\{/);
console.log('checkout address completion, geocoding preservation, error feedback, accessibility and asset cache tests passed');
