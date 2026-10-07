const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('frontend/customer/catalogue.js','utf8');
const app=fs.readFileSync('app.js','utf8');

assert.match(source,/window\.FreshWayCustomerAPI\?\.request/);
assert.match(source,/Promise\.allSettled\(\[/);
assert.doesNotMatch(source,/fetch\(['"]\/api\/(categories|products)/);
assert.match(source,/window\.FreshWayCustomerCatalogue\?\.setProducts/);
assert.match(source,/window\.FreshWayCustomerCatalogue\?\.clear/);
assert.match(source,/role="alert"/);
assert.match(source,/fwCatalogueRetry/);
assert.doesNotMatch(app,/FALLBACK_PRODUCTS/);
assert.match(app,/window\.FreshWayCustomerCatalogue/);

console.log('catalogue server-authority/error-boundary OK');

const productView=fs.readFileSync('frontend/customer/product-view.js','utf8');
assert.match(productView,/stock_status/);
assert.match(productView,/OUT OF STOCK/);
assert.match(productView,/data-plus/);
assert.match(productView,/stock-cart-warning/);

const media=fs.readFileSync('frontend/catalogue-media.js','utf8');
assert.match(media,/cat-oils/);
assert.match(media,/p-1788808795819-x0yy/);
assert.match(media,/groundnut-oil\.svg/);
assert.doesNotMatch(media,/api\\/admin|r2|D1/i);
assert.match(productView,/FreshWayCatalogueMedia/);
console.log('catalogue UI-only media mapping OK');
