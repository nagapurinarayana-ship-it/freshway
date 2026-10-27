const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
const css=fs.readFileSync('admin.css','utf8');
const catalogue=fs.readFileSync('frontend/admin/catalogue.js','utf8');
assert.match(source,/__freshwayOwner/);
assert.match(source,/history\.pushState/);
assert.match(source,/history\.back|popstate/);
assert.match(source,/historyMode:'none'/);
assert.match(source,/historyMode==='push'/);
assert.doesNotMatch(source,/if\(screen==='catalogue'\)renderProducts\(\)/,
  'the legacy catalogue renderer must not run when navigating to Catalogue');
assert.match(source,/const s=e\.target\.closest\('\[data-screen\]'\);if\(s\)\{e\.preventDefault\(\);window\.navigateAdminScreen\(s\.dataset\.screen\);return\}/,
  'Owner navigation clicks must use the modern screen handler');
assert.match(source,/window\.navigateAdminScreen\(requested,\{historyMode:'none'\}\)/,
  'browser back/forward must use the same screen handler without adding history entries');
assert.match(catalogue,/window\.navigateAdminScreen=function\(id,options\)\{const result=baseNavigate\(id,options\);if\(id==='catalogue'\)/,
  'the modern Catalogue handler must preserve browser history options');
assert.match(source,/const current=document\.querySelector\('\.screen\.active'\)/,'back navigation must remember the currently visible Owner screen before asking to discard changes');
assert.match(source,/if\(activeAfter===current&&requested!==current\)\{[\s\S]*history\.pushState\(state,'','#'\+current\)/,'cancelling a back navigation must restore the current screen URL');
assert.match(source,/classList\.toggle\('owner-authenticated',yes\)/,'navigation must become available only after Owner authentication succeeds');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.side/,'desktop navigation must remain hidden while signed out');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.mobile-nav/,'mobile navigation must remain hidden while signed out');
assert.match(css,/\.app:not\(\.owner-navigation-ready\) #appView\{visibility:hidden!important\}/,
  'the default HTML screen must not flash before route restoration completes');

// Initial bootstrap must run after every trailing script has registered its module.
// Without this guard, a direct refresh on #settings runs before Store Profile exists.
assert.match(source,/function startOwnerApp\(\)/);
assert.match(source,/document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',startOwnerApp,\{once:true\}\)/);
assert.match(source,/async function bootstrap\(force=false\)\{if\(!session\(\)&&!force\)return;const target=setAdminScreenVisual\(location\.hash\.slice\(1\)\|\|'overview'\);\$\('\.app'\)\?\.classList\.add\('owner-navigation-ready'\);try\{/,
  'the requested hash route must be selected before revealing the Owner app');
assert.match(source,/classList\.remove\('owner-navigation-ready'\);auth\(true\);window\.dispatchEvent\(new Event\('freshway:admin-authenticated'\)\);await bootstrap\(\)/,
  'Owner sign-in must hide the app again until the selected route is restored');
assert.match(source,/if\(session\(\)\)\{\s*auth\(true\);\s*bootstrap\(\);\s*\}else\{/,
  'refresh startup must enter through route-aware bootstrap');
assert.ok(html.indexOf('admin.js?v=20261027-navigation-boot-guard-v1') < html.indexOf('frontend/admin/store-profile.js'),
  'the regression test should cover the real script-loading order');
assert.match(html,/id="accountDeletionSummary"/);
assert.match(html,/class="owner-nav-more"/,'desktop navigation should group occasional tools under More');
assert.match(html,/data-screen="delivery">⌁<span>Delivery<\/span>/,'Delivery should be a primary mobile destination');
assert.match(html,/class="mobile-more-group"/,'mobile More menu should group secondary tools');
assert.match(html,/\.mobile-more-card>\.mobile-more-group>button\{[^}]*border:1px solid var\(--line\)[^}]*border-radius:12px/,'mobile More buttons must use consistent rounded borders instead of browser-default button outlines');
assert.match(html,/\.mobile-more-card>\.mobile-more-group\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'mobile More options must align in a responsive two-column grid');
const primaryNav=html.match(/<nav aria-label="Owner navigation">([\s\S]*?)<details class="owner-nav-more">/)?.[1]||'';
assert.doesNotMatch(primaryNav,/data-screen="settings"/,'Settings should not crowd the primary desktop navigation');
assert.match(html,/mobile-more-label">Reports & settings/,'less-used options should be grouped under a clear heading');
assert.match(source,/else if\(target==='offers'\)\{await window\.FreshWayOwnerDeliveryOffers\?\.load\(\);\}/,'direct refresh on #offers must load delivery settings and coupons');
assert.ok(html.indexOf('frontend/admin/delivery-offers.js?v=20261027-coupon-buttons-v5') < html.indexOf('admin.js?v=20261027-navigation-boot-guard-v1'), 'Delivery & Offers must load before Owner bootstrap so a direct #offers route can call its loader');
assert.match(html,/data-more-screen="offers">🎟 Delivery & offers/,'mobile More menu must expose Delivery & Offers');
console.log('owner navigation history and safe initial settings bootstrap OK');
