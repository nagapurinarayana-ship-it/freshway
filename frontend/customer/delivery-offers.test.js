const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('frontend/customer/delivery-offers.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('sw.js','utf8');

assert.match(source,/Number\(pricing\.standardDeliveryFee\) > 0 && pricing\.freeDeliveryEnabled && !pricing\.qualifiesForFreeDelivery/,
  'do not show threshold progress when delivery is already free at every order amount');
assert.ok(index.includes('frontend/customer/delivery-offers.js?v=20261027-fixed-coupons-v2'),
  'HTML must load the updated delivery-offers module');
assert.ok(worker.includes('/frontend/customer/delivery-offers.js?v=20261027-fixed-coupons-v2'),
  'service worker must cache the updated delivery-offers module');
assert.match(worker,/const CACHE = 'freshway-v90'/,
  'the service-worker cache version must match the current customer shell');
console.log('customer delivery-offers progress and cache-version assertions passed');
