const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/customer/promotions.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

assert.match(source, /INTERVAL=5000/);
assert.match(source, /pointerdown/);
assert.match(source, /pointerup/);
assert.match(source, /translate3d/);
assert.match(source, /object-fit:contain/);
assert.match(source, /naturalWidth/);
assert.match(source, /naturalHeight/);
assert.match(source, /viewport\.style\.aspectRatio/);
assert.match(source, /\.fw-promo-controls\{position:relative;/);
assert.doesNotMatch(source, /\.fw-promo-controls\{position:absolute/);
assert.doesNotMatch(source, /object-fit:cover/);
assert.match(source, /promotions\.length<2/);
assert.match(source, /FreshWayCustomerAPI\?\.request/);
assert.ok(index.includes('frontend/customer/promotions.js?v=20261020-promo-natural-fit-v2'), 'index must reference the full-image-fit customer banner asset');
assert.ok(sw.includes('/frontend/customer/promotions.js?v=20261020-promo-natural-fit-v2'), 'service worker must cache the full-image-fit customer banner asset');

assert.match(sw, /freshway-v48/);
console.log('customer promotion carousel: complete natural-ratio banners and unobstructed artwork OK');
