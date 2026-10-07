const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('frontend/customer/catalogue.js','utf8');

assert.match(source,/window\.FreshWayCustomerAPI\?\.request/);
assert.match(source,/Promise\.allSettled\(\[/);
assert.doesNotMatch(source,/fetch\(['"]\/api\/(categories|products)/);
assert.match(source,/aria-hidden="true"/);

console.log('catalogue API/accessibility boundary OK');
