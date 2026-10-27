const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
assert.match(source,/__freshwayOwner/);
assert.match(source,/history\.pushState/);
assert.match(source,/history\.back|popstate/);
assert.match(source,/historyMode:'none'/);
assert.match(source,/historyMode==='push'/);

// Initial bootstrap must run after every trailing script has registered its module.
// Without this guard, a direct refresh on #settings runs before Store Profile exists.
assert.match(source,/function startOwnerApp\(\)/);
assert.match(source,/document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',startOwnerApp,\{once:true\}\)/);
assert.ok(html.indexOf('admin.js?v=20261027-owner-simple-v1') < html.indexOf('frontend/admin/store-profile.js'),
  'the regression test should cover the real script-loading order');
assert.match(html,/id="accountDeletionSummary"/);
assert.match(html,/class="owner-nav-more"/,'desktop navigation should group occasional tools under More');
assert.match(html,/data-screen="delivery">⌁<span>Delivery<\/span>/,'Delivery should be a primary mobile destination');
assert.match(html,/class="mobile-more-group"/,'mobile More menu should group secondary tools');
assert.doesNotMatch(html,/<nav aria-label="Owner navigation">[\s\S]*?<button data-screen="settings"/,'Settings should not crowd the primary desktop navigation');
console.log('owner navigation history and safe initial settings bootstrap OK');
