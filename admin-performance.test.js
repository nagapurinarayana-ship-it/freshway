const assert=require('node:assert/strict');
const fs=require('node:fs');

const admin=fs.readFileSync('admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const auth=fs.readFileSync('worker/src/admin-auth.js','utf8');
const response=fs.readFileSync('worker/src/admin-response.js','utf8');

assert.match(admin,/if\(target==='overview'\)\{await Promise\.all\(\[loadSummary\(\),loadBusiness\(\),loadHome\(\)\]\);\}/);
assert.doesNotMatch(admin,/const target=setAdminScreenVisual\(location\.hash\.slice\(1\)\|\|'overview'\);try\{await loadSummary\(\);await loadBusiness\(\);await loadHome\(\);/);
assert.match(admin,/refreshOwnerAfterOrderMutation\(\)/);
assert.doesNotMatch(admin,/localStorage\.setItem\(['"]freshway-admin-session['"]/);
assert.doesNotMatch(admin,/sessionStorage\.setItem\(['"]freshway-admin-session['"]/);
assert.match(admin,/AUTH_HINT='freshway-admin-auth'/);
assert.match(html,/admin\.js\?v=20261019-owner-order-reliability-v1/);

assert.match(sw,/const CACHE = 'freshway-v\d+'/);
assert.match(sw,/const cached = await cache\.match\(event\.request\)/);
assert.match(sw,/event\.waitUntil\(update\.catch\(\(\) => undefined\)\)/);
assert.match(sw,/url\.pathname === '\/admin\.html' \|\| url\.pathname\.startsWith\('\/admin\/'\)/);
assert.match(sw,/keys\.filter\(key => key\.startsWith\('freshway-'\) && key !== CACHE\)/);
assert.doesNotMatch(sw,/\/admin\.css\?v=/);
assert.doesNotMatch(sw,/\/admin\.js\?v=/);
assert.match(sw,/if \(cached && !freshCode\)/);
assert.match(sw,/cache: 'no-store'/);
assert.doesNotMatch(sw,/\.catch\(\(\) => \{\}\)/);

assert.match(auth,/COOKIE='__Host-freshway-admin-session'/);
assert.match(auth,/response\(\{ok:true,version:ADMIN_AUTH_VERSION\}/);
assert.doesNotMatch(auth,/response\(\{ok:true,version:ADMIN_AUTH_VERSION,session\}/);
assert.match(auth,/SameSite=Lax/);
assert.match(response,/SameSite=Lax/);

const ownerSw = fs.readFileSync('admin/sw.js','utf8');
assert.match(ownerSw,/const CACHE = 'fw-owner-v\d+'/);
assert.match(ownerSw,/key\.startsWith\('fw-owner-'\)/);
assert.doesNotMatch(ownerSw,/caches\.delete\(key\).*freshway-/);
console.log('Owner reload, cache, performance and session-storage audit contracts OK');

assert.ok(require('node:fs').readFileSync('worker/migrations/0021_hard_reset_obsolete_orders.sql','utf8').includes("'apple','banana','grapes','guava'"));
