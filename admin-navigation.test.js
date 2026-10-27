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
assert.ok(html.indexOf('admin.js?v=20261027-customer-messages-v1') < html.indexOf('frontend/admin/store-profile.js'),
  'the regression test should cover the real script-loading order');
assert.match(html,/id="accountDeletionSummary"/);
console.log('owner navigation history and safe initial settings bootstrap OK');

// Keep the Owner UI calm by default; secondary tools and advanced order filters stay tucked away.
assert.match(html, /class="owner-nav-more"/);
assert.match(html, /data-screen="overview"[\\s\\S]*?data-screen="orders"[\\s\\S]*?data-screen="catalogue"[\\s\\S]*?data-screen="customers"/);
assert.match(html, /<details class="panel business-panel">/);
assert.match(html, /<details class="panel home-preview" open>/);
assert.match(html, /<details class="panel home-preview">/);
assert.match(html, /id="orderAdvancedFilters" class="order-advanced-filters"/);
assert.match(html, /id="orderPayment"/);
assert.match(html, /id="orderPlan"/);
assert.match(html, /id="orderSort"/);
assert.match(html, /id="mobileMoreBtn"/);
assert.match(html, /<details open><summary>Operations<\\/summary>/);
console.log('Owner UI defaults to core tasks, with secondary navigation and filters collapsed');
