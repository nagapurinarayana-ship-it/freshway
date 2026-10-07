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
