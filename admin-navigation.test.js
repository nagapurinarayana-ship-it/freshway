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
assert.match(html,/class="owner-nav-primary" data-screen="orders"/,'Orders must remain a primary Owner navigation item');
assert.match(html,/<details class="owner-nav-more" id="ownerNavMore">/,'secondary Owner tools must be grouped under More tools');
assert.match(html,/<details class="owner-business-details">/,'business metrics must be collapsed by default to reduce dashboard clutter');
assert.match(html,/<details class="panel owner-secondary-home">/,'recent customers must be available without taking over the dashboard');
const sideNav=html.slice(html.indexOf('<aside class="side">'),html.indexOf('<main>'));
assert.match(sideNav,/<button class="owner-nav-primary" data-screen="orders">/,'Orders must remain in the primary navigation');
assert.match(sideNav,/<details class="owner-nav-more" id="ownerNavMore">[\s\S]*data-screen="messages"/,'Customer messages must remain reachable inside More tools');
assert.doesNotMatch(sideNav.slice(0,sideNav.indexOf('<details class="owner-nav-more"')),/data-screen="messages|customers|catalogue|reports|settings/,'secondary options must not crowd the primary navigation');
assert.match(html,/mobile-more-group/,'mobile More menu must group secondary options');
assert.match(html,/#kpis \.kpi:nth-child\(n\+5\)\{display:none\}/,'dashboard must show only four primary KPI cards');

console.log('owner navigation history and safe initial settings bootstrap OK');
