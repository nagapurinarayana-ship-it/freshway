const assert=require('node:assert/strict');
const fs=require('node:fs');

const view=fs.readFileSync('frontend/customer/product-view.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const adminCss=fs.readFileSync('admin.css','utf8');
const sw=fs.readFileSync('sw.js','utf8');

assert.match(view,/product-action-info/);
assert.match(view,/product-action-control/);
assert.match(css,/\.product-action-info/);
assert.match(css,/\.product-action-control/);
assert.match(css,/fw-cart-bar-visible main/);
assert.match(adminCss,/\.customer-card \.address/);
assert.match(sw,/freshway-v29/);
assert.doesNotMatch(sw,/admin\.css\?v=20260907-owner-v2/);
assert.doesNotMatch(sw,/app\.js\?v=20261007-catalogue-a1/);

const admin=fs.readFileSync('admin.js','utf8');
const lifecycle=fs.readFileSync('owner-lifecycle.js','utf8');
const adminHtml=fs.readFileSync('admin.html','utf8');
assert.match(admin,/function openOwnerOverlay/);
assert.match(admin,/__freshwayOwnerOverlay/);
assert.match(admin,/if\(ownerOverlayElement\(\)\)\{closeOwnerOverlayNow\(\);return\}/);
assert.match(lifecycle,/openOwnerOverlay\(\$\('#modal'\)\)/);
assert.match(adminHtml,/openOwnerOverlay\(m\)/);
assert.match(adminHtml,/closeOwnerOverlay\(m\)/);
console.log('mobile visual and PWA freshness contract OK');
