const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
const css=fs.readFileSync('admin.css','utf8');
assert.match(source,/__freshwayOwner/);
assert.match(source,/history\.pushState/);
assert.match(source,/history\.back|popstate/);
assert.match(source,/historyMode:'none'/);
assert.match(source,/historyMode==='push'/);
assert.match(source,/classList\.toggle\('owner-authenticated',yes\)/,'navigation must become available only after Owner authentication succeeds');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.side/,'desktop navigation must remain hidden while signed out');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.mobile-nav/,'mobile navigation must remain hidden while signed out');

// Initial bootstrap must run after every trailing script has registered its module.
// Without this guard, a direct refresh on #settings runs before Store Profile exists.
assert.match(source,/function startOwnerApp\(\)/);
assert.match(source,/document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',startOwnerApp,\{once:true\}\)/);
assert.ok(html.indexOf('admin.js?v=20261027-delivery-offers-v2') < html.indexOf('frontend/admin/store-profile.js'),
  'the regression test should cover the real script-loading order');
assert.match(html,/id="accountDeletionSummary"/);
assert.match(html,/class="owner-nav-more"/,'desktop navigation should group occasional tools under More');
assert.match(html,/data-screen="delivery">⌁<span>Delivery<\/span>/,'Delivery should be a primary mobile destination');
assert.match(html,/class="mobile-more-group"/,'mobile More menu should group secondary tools');
const primaryNav=html.match(/<nav aria-label="Owner navigation">([\s\S]*?)<details class="owner-nav-more">/)?.[1]||'';
assert.doesNotMatch(primaryNav,/data-screen="settings"/,'Settings should not crowd the primary desktop navigation');
assert.match(html,/mobile-more-label">Reports & settings/,'less-used options should be grouped under a clear heading');
console.log('owner navigation history and safe initial settings bootstrap OK');
