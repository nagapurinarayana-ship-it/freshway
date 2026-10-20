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
assert.match(css,/body\\{padding-bottom:calc\\(84px \\+ env\\(safe-area-inset-bottom,0px\\)\\)\\}/,'body reserves Android safe-area space');
assert.match(css,/main\\{padding:14px 16px calc\\(98px \\+ env\\(safe-area-inset-bottom,0px\\)\\)\\}/,'main reserves space below fixed navigation');
assert.match(css,/\\.bottom-nav\\{height:calc\\(68px \\+ env\\(safe-area-inset-bottom,0px\\)\\)\\}/,'bottom navigation includes device safe area');
assert.match(css,/\\.info-page\\{display:grid;gap:10px;padding:2px 0 8px;min-width:0\\}/,'business pages use shared scroll reserve instead of double bottom padding');
assert.match(css,/\\.store-about-hero\\{[^}]*min-width:0\\}/,'About brand panel may shrink safely on narrow viewports');
assert.match(css,/\\.store-info-section\\{[^}]*min-width:0\\}/,'store details cards prevent horizontal overflow');
assert.match(css,/\\.store-contact-cta\\{[^}]*overflow-wrap:anywhere\\}/,'contact action text wraps within the usable viewport');

assert.match(adminCss,/\.customer-card \.address/);
assert.match(sw,/const CACHE = 'freshway-v\d+'/);
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
