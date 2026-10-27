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
assert.match(source,/const current=document\.querySelector\('\.screen\.active'\)/,'back navigation must remember the currently visible Owner screen before asking to discard changes');
assert.match(source,/if\(activeAfter===current&&requested!==current\)\{[\s\S]*history\.pushState\(state,'','#'\+current\)/,'cancelling a back navigation must restore the current screen URL');
assert.match(source,/classList\.toggle\('owner-authenticated',yes\)/,'navigation must become available only after Owner authentication succeeds');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.side/,'desktop navigation must remain hidden while signed out');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.mobile-nav/,'mobile navigation must remain hidden while signed out');

// Initial bootstrap must run after every trailing script has registered its module.
// Without this guard, a direct refresh on #settings runs before Store Profile exists.
assert.match(source,/function startOwnerApp\(\)/);
assert.match(source,/document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',startOwnerApp,\{once:true\}\)/);
assert.ok(html.indexOf('admin.js?v=20261027-owner-offers-draft-guard-v2') < html.indexOf('frontend/admin/store-profile.js'),
  'the regression test should cover the real script-loading order');
assert.match(html,/id="accountDeletionSummary"/);
assert.match(html,/class="owner-nav-more"/,'desktop navigation should group occasional tools under More');
assert.match(html,/data-screen="delivery">⌁<span>Delivery<\/span>/,'Delivery should be a primary mobile destination');
assert.match(html,/class="mobile-more-group"/,'mobile More menu should group secondary tools');
const primaryNav=html.match(/<nav aria-label="Owner navigation">([\s\S]*?)<details class="owner-nav-more">/)?.[1]||'';
assert.doesNotMatch(primaryNav,/data-screen="settings"/,'Settings should not crowd the primary desktop navigation');
assert.match(html,/mobile-more-label">Reports & settings/,'less-used options should be grouped under a clear heading');
assert.match(source,/else if\(target==='offers'\)\{await window\.FreshWayOwnerDeliveryOffers\?\.load\(\);\}/,'direct refresh on #offers must load delivery settings and coupons');
assert.ok(html.indexOf('frontend/admin/delivery-offers.js?v=20261027-fixed-coupons-v4') < html.indexOf('admin.js?v=20261027-owner-offers-draft-guard-v2'), 'Delivery & Offers must load before Owner bootstrap so a direct #offers route can call its loader');
assert.match(html,/data-more-screen="offers">🎟 Delivery & offers/,'mobile More menu must expose Delivery & Offers');
console.log('owner navigation history and safe initial settings bootstrap OK');
