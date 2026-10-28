const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('address-system-final.js', 'utf8');
const geocode = fs.readFileSync('frontend/customer/address-geocode.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const css = fs.readFileSync('frontend/customer/address-book.css', 'utf8');
const notifications = fs.readFileSync('notifications.js', 'utf8');

assert.match(source, /function checkoutAddressIssue\(address\)/);
assert.match(source, /const SELECTED_ADDRESS_STORAGE_KEY = 'freshway-selected-address-id-v1'/,
  'the explicit selected address must survive page refresh independently of the default address');
assert.match(source, /function persistedAddressId\(\)[\s\S]*?localStorage\.getItem\(SELECTED_ADDRESS_STORAGE_KEY\)/,
  'address selection must be restored from persistent selected-address state');
assert.match(source, /const previousId = preserveSelection \? persistedAddressId\(\) : null/,
  'address reload must use the explicitly selected address and not accidentally freeze the default');
assert.match(source, /if \(returnedAddress && \(!editingAddress \|\| modalOrigin === 'checkout'\)\)[\s\S]*?persistAddressSelection\(returnedAddress\)/,
  'a new address added from Home/Profile must immediately become the active delivery address');
assert.match(source, /if \(profile\) profile\.textContent = preferred \?/,
  'Home and Profile must display the same selected address rather than Home-selected/Profile-default');
assert.match(source, /function setActive\(address\)[\s\S]*?persistAddressSelection\(activeAddress\)/,
  'choosing a saved address must persist the selection for checkout and refresh');
assert.match(source, /let selectionRevision = 0/,
  'address selection must track changes made while a saved-address refresh is in flight');
assert.match(source, /const revisionAtStart = selectionRevision[\s\S]*?selectionRevision !== revisionAtStart[\s\S]*?Never let an older background request overwrite a choice made while it was in flight/,
  'a stale initial address fetch must not replace a newer explicit selection');
assert.match(source, /loadSaved\(\{ preserveSelection: true, showError: false \}\)/,
  'initial load must restore the selected address or fall back to the default');
assert.match(source, /if \(previousId != null && !restoredSelection\) persistAddressSelection\(null\)/,
  'a deleted or foreign-account selection must be cleared so the current default is used');
assert.match(source, /if \(previousActiveId != null && !retainedActive\) persistAddressSelection\(null\)/,
  'deleting the selected address must clear the old preference and fall back to default');
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
assert.match(source, /function editCheckoutAddress\(\)[\s\S]*?openCheckoutAddressManager\(\)/);
assert.match(source, /<details class="fw-address-additional"><summary>Additional details/);
assert.match(source, /<label>House \/ flat number/);
assert.match(source, /<label>Area \/ colony/);
assert.match(source, /<label>PIN code/);
assert.match(source, /if \(target\.closest\('#fwCheckoutChangeAddress'\)\)[\s\S]*?editCheckoutAddress\(\)/);
assert.match(source, /buildEditor\(editAddressId\)/);
assert.match(source, /modalOrigin === 'checkout' && returnedAddress/);
assert.match(source, /hideModal\(\);\s*syncCheckout\(\);/);
assert.match(source, /isDefault: editingAddress \? !!editingAddress\.isDefault : addresses\.length === 0/);
assert.match(source, /window\.FreshWayAddressGeocode/);
assert.match(source, /fetch\('\/api\/geocode\/reverse\?lat='/, 'reverse geocoding must go through the same-origin Worker proxy');
assert.doesNotMatch(source, /const preserve = labelFields\.map/, 'old address fields must not overwrite a newly geocoded location');
assert.match(source, /if \(locationLookupPending\) return toast/, 'save must be blocked while the map lookup is pending');
assert.match(source, /editorCoordinates = previousCoordinates/, 'failed geocoding must restore the last verified pin');
assert.match(source, /if \(previousCoordinates && validCoords\(previousCoordinates\.latitude, previousCoordinates\.longitude\)\)[\s\S]*?previous pin and address were restored/,
  'failed lookup with a verified prior pin must restore that pin and address together');
assert.match(source, /\['fwAddrHouse','fwAddrBuilding','fwAddrFloor','fwAddrStreet','fwAddrArea','fwAddrLocality','fwAddrCity','fwAddrDistrict','fwAddrState','fwAddrPincode','fwAddrLandmark'\][\s\S]*?setValue\(id, ''\)/,
  'failed lookup without a verified prior pin must clear stale geographic fields and PIN');
assert.match(source, /Map-derived address is a suggestion\. Confirm the house\/flat number and 6-digit PIN code/,
  'map-derived address and PIN must be presented as suggestions to verify');
assert.match(geocode, /houseFlat: first\(a\.house_number, a\.house_name\)/);
assert.match(geocode, /pincode: indianPincode\(a\.postcode\)/);
assert.match(geocode, /landmark: first\(result && result\.name, a\.amenity, a\.shop\)/);
assert.match(geocode, /recipientName: text\(old\.recipientName\)/);
assert.match(geocode, /note: text\(old\.note\)/);
assert.match(source, /let guestAddressMode = false/);
assert.match(source, /if \(guestAddressMode && !editingAddress\)[\s\S]*?Delivery location set for this visit/, 
  'guest checkout must keep a validated address in memory instead of requiring the saved-address API');
assert.match(source, /if \(!loaded\)[\s\S]*?if \(guestAddressMode\)[\s\S]*?buildEditor/,
  'a 401 on saved addresses must open the checkout address editor rather than an Addresses unavailable dead end');
assert.match(source, /const guestDraft = guestAddressMode/,
  'reopening the guest editor must retain the in-memory address draft');
assert.match(source, /if \(guestAddressMode\)[\s\S]*?buildEditor/,
  'guests opening Change from Home or Profile must get the address editor instead of a sign-in dead end');
assert.match(source, /Use this delivery location for this visit\. Sign in to save it for next time\./,
  'guest address UI must explain that the selected location is temporary without forcing sign-in');
assert.match(source, /async function findSearch\(\)[\s\S]*?searchRequestId[\s\S]*?countrycodes: 'in'/,
  'map search must validate India-only results and ignore stale concurrent searches');
assert.match(source, /No matching Indian map result/,
  'empty map searches must offer useful recovery steps');
assert.match(source, /addressLoadError = error\.message/);
assert.match(source, /id="addressModalTitle" tabindex="-1"/);
assert.match(source, /modalReturnFocus/);
assert.ok(index.includes('frontend/customer/address-geocode.js?v=20261021-guest-address-map-search-v3'), 'HTML must load the current geocode field mapper');
assert.ok(sw.includes('/frontend/customer/address-geocode.js?v=20261021-guest-address-map-search-v3'), 'service worker must cache the current geocode field mapper');
assert.ok(index.includes('address-system-final.js?v=20261028-selection-race-v2'), 'HTML must load the selected-address fix');
assert.ok(sw.includes('/address-system-final.js?v=20261028-selection-race-v2'), 'service worker must cache the selected-address fix');
assert.ok(index.includes('address-book.css?v=20261027-checkout-ux-v2'), 'HTML must load the current address CSS');
assert.ok(sw.includes('/frontend/customer/address-book.css?v=20261027-checkout-ux-v2'), 'service worker must cache the current address CSS');
assert.ok(index.includes('notifications.js?v=notif1'), 'HTML must load the notification permission-state module');
assert.ok(sw.includes('/notifications.js?v=notif1'), 'service worker must cache the notification permission-state module');
assert.match(sw, /const CACHE = 'freshway-v97'/);
assert.match(css, /#toast\s*\{[^}]*white-space:\s*normal/s);
assert.match(css, /\.fw-address-incomplete\s*\{/);
console.log('checkout address completion, geocoding preservation, error feedback, accessibility and asset cache tests passed');
