const assert=require('node:assert/strict');
const fs=require('node:fs');

const admin=fs.readFileSync('admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
const customerHtml=fs.readFileSync('index.html','utf8');
const headers=fs.readFileSync('_headers','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const ownerSw=fs.readFileSync('admin/sw.js','utf8');
const ownerRouter=fs.readFileSync('functions/admin/[[path]].js','utf8');
function assertVersionedCodeReferences(source,label){
  for(const [,tag] of source.matchAll(/<(script|link)\b[^>]*>/gi)){
    const isScript=tag.toLowerCase().startsWith('<script');
    const isStylesheet=tag.toLowerCase().startsWith('<link')&&/\brel=["']stylesheet["']/i.test(tag);
    if(!isScript&&!isStylesheet)continue;
    const match=tag.match(isScript?/\bsrc=["']([^"']+)["']/i:/\bhref=["']([^"']+)["']/i);
    if(!match||!/\.(?:js|css)(?:\?|$)/i.test(match[1])||/^[a-z][a-z0-9+.-]*:/i.test(match[1]))continue;
    assert.match(match[1],/[?&]v=[^&]+/,label+' code asset must carry a version query: '+match[1]);
  }
}
assertVersionedCodeReferences(customerHtml,'Customer app');
assertVersionedCodeReferences(html,'Owner app');
const auth=fs.readFileSync('worker/src/admin-auth.js','utf8');
const response=fs.readFileSync('worker/src/admin-response.js','utf8');

assert.match(admin,/if\(target==='overview'\)\{await Promise\.all\(\[loadSummary\(\),loadBusiness\(\),loadHome\(\)\]\);\}/);
assert.doesNotMatch(admin,/const target=setAdminScreenVisual\(location\.hash\.slice\(1\)\|\|'overview'\);try\{await loadSummary\(\);await loadBusiness\(\);await loadHome\(\);/);
assert.match(admin,/refreshOwnerAfterOrderMutation\(\)/);
assert.doesNotMatch(admin,/localStorage\.setItem\(['"]freshway-admin-session['"]/);
assert.doesNotMatch(admin,/sessionStorage\.setItem\(['"]freshway-admin-session['"]/);
assert.match(admin,/AUTH_HINT='freshway-admin-auth'/);
assert.match(html,/admin\.js\?v=20261027-owner-offers-draft-guard-v2/);
assert.match(html,/admin\.css\?v=20261027-delivery-offers-v2/);
assert.doesNotMatch(html,/admin\.js\?v=20261027-customer-messages-v1/,'Owner HTML must not retain the previous script version after simplification');
assert.doesNotMatch(html,/\.exact-location/);

assert.match(sw,/const CACHE = 'freshway-v\d+'/);
assert.match(sw,/const cached = await cache\.match\(event\.request\)/);
assert.match(sw,/event\.waitUntil\(update\.catch\(\(\) => undefined\)\)/);
assert.match(sw,/url\.pathname === '\/admin\.html' \|\| url\.pathname\.startsWith\('\/admin\/'\)/);
assert.match(sw,/keys\.filter\(key => key\.startsWith\('freshway-'\) && key !== CACHE\)/);
assert.doesNotMatch(sw,/\/admin\.css\?v=/);
assert.doesNotMatch(sw,/\/admin\.js\?v=/);
assert.match(sw,/if \(cached && isVersionedCode\) return cached/);
assert.match(sw,/if \(cached\) \{/);
assert.doesNotMatch(sw,/cached && !freshCode/);
assert.match(sw,/cache: 'no-store'/);
assert.doesNotMatch(sw,/\.catch\(\(\) => \{\}\)/);

assert.match(auth,/COOKIE='__Host-freshway-admin-session'/);
assert.match(auth,/response\(\{ok:true,version:ADMIN_AUTH_VERSION\}/);
assert.doesNotMatch(auth,/response\(\{ok:true,version:ADMIN_AUTH_VERSION,session\}/);
assert.match(auth,/SameSite=Lax/);
assert.match(response,/SameSite=Lax/);

assert.match(ownerSw,/const CACHE = 'fw-owner-v54'/);
assert.match(ownerSw,/if \(cached && isVersionedCode\) return cached/);
assert.match(ownerSw,/if \(isDocument \|\| isManifest\)/);
assert.match(ownerRouter,/OWNER_VERSIONED_ASSET_CACHE_CONTROL/);
assert.match(ownerRouter,/OWNER_MEDIA_CACHE_CONTROL/);
assert.match(headers,/\/app\.js\n  Cache-Control: public, max-age=31536000, immutable/);
assert.match(headers,/\/frontend\/\*\.js\n  Cache-Control: public, max-age=31536000, immutable/);
assert.match(headers,/\/sw\.js\n[\s\S]*?Cache-Control: no-store, max-age=0/);
assert.match(ownerSw,/const CACHE = 'fw-owner-v\d+'/);
assert.match(ownerSw,/key\.startsWith\('fw-owner-'\)/);
assert.doesNotMatch(ownerSw,/caches\.delete\(key\).*freshway-/);
console.log('Owner reload, cache, performance and session-storage audit contracts OK');

assert.ok(require('node:fs').readFileSync('worker/migrations/0021_hard_reset_obsolete_orders.sql','utf8').includes("'apple','banana','grapes','guava'"));
