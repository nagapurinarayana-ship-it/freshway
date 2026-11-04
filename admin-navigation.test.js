const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
const css=fs.readFileSync('admin.css','utf8');
const ownerAddress=fs.readFileSync('owner-address-final.js','utf8');
const lifecycle=fs.readFileSync('owner-lifecycle.js','utf8');
const catalogue=fs.readFileSync('frontend/admin/catalogue.js','utf8');
const storeManagement=fs.readFileSync('frontend/admin/store-management.js','utf8');
const orderAlerts=fs.readFileSync('frontend/admin/order-alerts.js','utf8');
const accountDeletions=fs.readFileSync('frontend/admin/account-deletions.js','utf8');
assert.match(css,/--muted:#647169/,'secondary Owner text must meet WCAG AA contrast against white');
assert.match(css,/\.login-card p,\.login-card small\{font-size:12px;line-height:1\.6\}/,'sign-in helper text must be readable on mobile');
assert.match(css,/\.toast\{font-size:12px;z-index:1101;background:#123b2b;color:#fff\}/,'Owner toast must remain readable above the startup overlay');
assert.match(source,/__freshwayOwner/);
assert.match(source,/history\.pushState/);
assert.match(source,/history\.back|popstate/);
assert.match(source,/historyMode:'none'/);
assert.match(source,/s\?\.\__freshwayOwner\?\(s\.screen\|\|'overview'\):\(location\.hash\.slice\(1\)\|\|'overview'\)/,'popstate must restore the URL hash when older history entries have no Owner state');
assert.match(ownerAddress,/freshNavigate=function\(id,\.\.\.args\)[\s\S]*baseFreshNavigate\(id,\.\.\.args\)/,'the freshness wrapper must preserve navigation options such as historyMode:none');
assert.match(catalogue,/navigateAdminScreen=function\(id,\.\.\.args\)[\s\S]*baseNavigate\(id,\.\.\.args\)/,'the Catalogue wrapper must preserve navigation options');
assert.doesNotMatch(lifecycle,/history\.replaceState\(null,'',`#\$\{id\}`\)/,'Catalogue navigation must not erase Owner history state');
assert.match(lifecycle,/id==='stores'[\s\S]*FreshWayOwnerStoreManagement/,'Owner refresh must reload Stores');
assert.match(lifecycle,/id==='requests'[\s\S]*FreshWayOwnerCustomerRequests/,'Owner refresh must reload customer requests');
assert.match(lifecycle,/id==='messages'[\s\S]*FreshWayOwnerCustomerMessages/,'Owner refresh must reload customer messages');
assert.match(lifecycle,/id==='offers'[\s\S]*FreshWayOwnerDeliveryOffers/,'Owner refresh must reload Delivery & Offers while respecting unsaved changes');
assert.match(storeManagement,/refresh:refreshStores/,'Store refresh must preserve the selected store and protect unsaved values');
assert.match(orderAlerts,/refreshHistory:[\s\S]*loadOwnerAlertHistory/,'Owner alert history must expose a refresh action');
assert.match(accountDeletions,/FreshWayOwnerAccountDeletions[\s\S]*load/,'Settings refresh must reload account deletion requests');
assert.match(source,/historyMode==='push'/);
assert.match(source,/const current=document\.querySelector\('\.screen\.active'\)/,'back navigation must remember the currently visible Owner screen before asking to discard changes');
assert.match(source,/if\(activeAfter===current&&requested!==current\)\{[\s\S]*history\.pushState\(state,'','#'\+current\)/,'cancelling a back navigation must restore the current screen URL');
assert.match(source,/classList\.toggle\('owner-authenticated',yes\)/,'navigation must become available only after Owner authentication succeeds');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.side/,'desktop navigation must remain hidden while signed out');
assert.match(css,/\.app:not\(\.owner-authenticated\)>\.mobile-nav/,'mobile navigation must remain hidden while signed out');

// Initial bootstrap must run after every trailing script has registered its module.
// Without this guard, a direct refresh on #settings runs before Store Profile exists.
assert.match(source,/function startOwnerApp\(\)/);
const ownerBootstrap=source.slice(source.indexOf('function startOwnerApp()'));
assert.ok(ownerBootstrap.indexOf("setAdminScreenVisual(location.hash.slice(1)||'overview')") < ownerBootstrap.indexOf('auth(true)'),
  'Owner must select the restored screen before revealing the authenticated app to prevent an Overview flash');
assert.match(source,/document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',startOwnerApp,\{once:true\}\)/);
assert.ok(html.indexOf('admin.js?v=20261105-owner-history-refresh-v1') < html.indexOf('frontend/admin/store-profile.js'),
  'the regression test should cover the real script-loading order');
assert.match(html,/id="accountDeletionSummary"/);
assert.match(html,/class="owner-nav-more"/,'desktop navigation should group occasional tools under More');
assert.match(html,/data-screen="delivery">⌁<span>Delivery<\/span>/,'Delivery should be a primary mobile destination');
assert.match(html,/class="mobile-more-group"/,'mobile More menu should group secondary tools');
assert.match(html,/if\(m&&!m\.classList\.contains\('hidden'\)\)\{closeOwnerOverlay\(m\);return\}if\(m\)m\.remove\(\);/,'mobile More menu must replace a previously dismissed hidden menu when it is opened again');
assert.match(html,/\.mobile-more-card>\.mobile-more-group>button\{[^}]*border:1px solid var\(--line\)[^}]*border-radius:12px/,'mobile More buttons must use consistent rounded borders instead of browser-default button outlines');
assert.match(html,/\.mobile-more-card>\.mobile-more-group\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'mobile More options must align in a responsive two-column grid');
const primaryNav=html.match(/<nav aria-label="Owner navigation">([\s\S]*?)<details class="owner-nav-more">/)?.[1]||'';
assert.doesNotMatch(primaryNav,/data-screen="settings"/,'Settings should not crowd the primary desktop navigation');
assert.match(html,/mobile-more-label">Reports & settings/,'less-used options should be grouped under a clear heading');
assert.match(source,/else if\(target==='offers'\)\{await window\.FreshWayOwnerDeliveryOffers\?\.load\(\);\}/,'direct refresh on #offers must load delivery settings and coupons');
assert.ok(html.indexOf('frontend/admin/delivery-offers.js?v=20261027-coupon-buttons-v5') < html.indexOf('admin.js?v=20261105-owner-history-refresh-v1'), 'Delivery & Offers must load before Owner bootstrap so a direct #offers route can call its loader');
assert.match(html,/data-more-screen="offers">🎟 Delivery & offers/,'mobile More menu must expose Delivery & Offers');
console.log('owner navigation history and safe initial settings bootstrap OK');
