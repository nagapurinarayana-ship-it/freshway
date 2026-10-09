const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/admin/catalogue.js', 'utf8');
const html = fs.readFileSync('admin.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const customerStyles = fs.readFileSync('styles.css', 'utf8');

assert.match(source, /\.fw-promo-preview\{[^}]*height:auto[^}]*aspect-ratio:auto/);
assert.match(source, /\.fw-promo-preview img\{[^}]*max-width:100%;max-height:320px;width:auto;height:auto;object-fit:contain/);
assert.match(source, /\.fw-product-icon\{height:auto;min-height:100px;aspect-ratio:4\/3/);
assert.match(source, /\.fw-cat-icon img,.fw-product-icon img\{[^}]*object-fit:contain;object-position:center/);
assert.match(source, /\.fw-image-preview img\{width:100%;height:100%;object-fit:contain/);
assert.match(source, /drawImage\(bitmap,0,0,canvas\.width,canvas\.height\)/);
assert.match(customerStyles, /\.product-image img\{[^}]*object-fit:contain/);
assert.ok(html.includes('frontend/admin/catalogue.js?v=20261009-full-image-fit-v1'), 'Owner must load the updated catalogue image-fit module');
assert.ok(sw.includes('/frontend/admin/catalogue.js?v=20261009-full-image-fit-v1'), 'service worker must cache the updated catalogue image-fit module');

console.log('Owner upload, banner preview, catalogue image-fit, and cache-version contract OK');
