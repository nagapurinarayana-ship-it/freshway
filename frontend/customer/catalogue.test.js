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
assert.match(source,/image_data&&x\.image_mime_type/);
assert.match(source,/'data:'\+x\.image_mime_type/);
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
assert.doesNotMatch(media, new RegExp('api/admin|r2|D1', 'i'));
assert.match(productView,/FreshWayCatalogueMedia/);
assert.match(productView,/image_data&&p\.image_mime_type/);
const ownerCatalogue=fs.readFileSync('frontend/admin/catalogue.js','utf8');
assert.match(ownerCatalogue,/type="file"/);
assert.match(ownerCatalogue,/compressProductImage/);
assert.match(ownerCatalogue,/imageData:image\.data/);
assert.match(ownerCatalogue,/fwCatImage/);
assert.match(ownerCatalogue,/fwRemoveCatImage/);
assert.match(ownerCatalogue,/Category image/);
const migration=fs.readFileSync('worker/migrations/0015_product_images.sql','utf8');
const categoryMigration=fs.readFileSync('worker/migrations/0016_category_images.sql','utf8');
assert.match(migration,/ALTER TABLE products ADD COLUMN image_data TEXT/);
assert.match(migration,/ALTER TABLE products ADD COLUMN image_mime_type TEXT/);
assert.match(categoryMigration,/ALTER TABLE categories ADD COLUMN image_data TEXT/);
assert.match(categoryMigration,/ALTER TABLE categories ADD COLUMN image_mime_type TEXT/);
const catalogueApi=fs.readFileSync('worker/src/catalogue-api.js','utf8');
assert.match(catalogueApi,/MAX_IMAGE_DATA/);
assert.match(catalogueApi,/image_data/);
assert.match(catalogueApi,/imageFields\(p,'Category'\)/);
assert.match(catalogueApi,/image_data,c\.image_mime_type/);
console.log('catalogue UI-only media mapping OK');
