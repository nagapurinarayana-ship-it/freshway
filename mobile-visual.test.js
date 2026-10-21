const assert=require('node:assert/strict');
const fs=require('node:fs');

const view=fs.readFileSync('frontend/customer/product-view.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const adminCss=fs.readFileSync('admin.css','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const index=fs.readFileSync('index.html','utf8');
assert.ok(index.includes('styles.css?v=20261021-four-products-fit-v1'),'HTML loads the current mobile viewport stylesheet');
assert.ok(index.includes('frontend/customer/category-fold-fit.css?v=20261021-full-images-refresh-v2'),'HTML loads the selected-category fold-fit stylesheet');
assert.ok(categoryFoldStyles.includes('height:100%!important;aspect-ratio:1/1'),'product artwork uses a square contained image box so the complete illustration is visible');
assert.ok(sw.includes('/styles.css?v=20261021-four-products-fit-v1'),'service worker caches the current mobile viewport stylesheet');
assert.ok(sw.includes('/frontend/customer/category-fold-fit.css?v=20261021-full-images-refresh-v2'),'service worker caches the selected-category fold-fit stylesheet');
assert.ok(index.includes('frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2'),'HTML loads the current category navigation asset');
assert.ok(sw.includes('/frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2'),'service worker caches the current category navigation asset');
assert.ok(css.includes('body{padding-bottom:calc(84px + env(safe-area-inset-bottom,0px))}'),'body reserves Android safe-area space');
assert.ok(css.includes('main{padding:14px 16px calc(98px + env(safe-area-inset-bottom,0px))}'),'main reserves scroll space below fixed navigation');
assert.ok(css.includes('.bottom-nav{height:calc(68px + env(safe-area-inset-bottom,0px))}'),'bottom navigation includes device safe area');
assert.ok(css.includes('.info-page{display:grid;gap:10px;padding:2px 0 8px;min-width:0}'),'About/Contact pages use the shared scroll reserve');
assert.ok(css.includes('.store-about-hero{margin-top:0;display:flex;align-items:center;gap:10px;padding:12px 13px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);min-width:0}'),'About brand panel shrinks safely on narrow screens');
assert.ok(css.includes('.store-info-section{background:#fff;border:1px solid var(--line);border-radius:16px;padding:12px;box-shadow:0 5px 16px rgba(20,70,45,.04);min-width:0}'),'store information cards prevent horizontal overflow');
assert.ok(css.includes('.store-contact-cta{display:flex;justify-content:center;align-items:center;min-height:48px;padding:10px 12px;border-radius:13px;'),'contact action remains compact and tappable');

assert.match(view,/product-action-info/);
assert.match(view,/product-action-control/);
assert.match(css,/\.product-action-info/);
assert.match(css,/\.product-action-control/);
assert.match(css,/fw-cart-bar-visible main/);

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
