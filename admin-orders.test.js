const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('admin.html','utf8');
const css=fs.readFileSync('admin.css','utf8');
const js=fs.readFileSync('admin.js','utf8');
const lifecycle=fs.readFileSync('owner-lifecycle.js','utf8');

assert.match(html,/class="toolbar order-toolbar"/);
assert.match(html,/id="orderAdvancedFilters" class="order-advanced-filters"/);
assert.match(html,/More filters/);
assert.match(html,/id="orderAdvancedCount"/);
assert.match(html,/From date/);
assert.match(html,/To date/);
assert.match(html,/Minimum amount/);
assert.match(html,/Maximum amount/);
assert.match(html,/Clear all/);

assert.match(css,/\.order-toolbar/);
assert.match(css,/\.order-advanced-filters/);
assert.match(css,/grid-template-columns:1fr 1fr/);
assert.match(css,/@media\(max-width:480px\)/);

assert.match(html,/id="liveOrdersTab"/);assert.match(html,/id="testOrdersTab"/);assert.match(js,/testOrders:modeAtStart\?'1':'0'/);assert.match(js,/data-test-order-toggle/);assert.match(js,/function orderFilterState/);
assert.ok(js.includes("$('#liveOrdersTab').onclick=()=>{if(!testOrderMode)return;"),'Live orders tab must switch back from Test orders mode');
assert.match(lifecycle,/function isTestModeActive\(\)/);
assert.match(lifecycle,/testOrders:testOrders\?'1':'0'/);
assert.match(lifecycle,/data-life-test-toggle=/);
assert.match(lifecycle,/data-is-test=/);
assert.match(js,/function validateOrderFilters/);
assert.match(js,/orderAdvancedFilters/);
assert.match(js,/orderAdvancedCount/);
assert.match(js,/orderFilterHint/);
assert.match(js,/f\.from&&f\.to&&f\.from>f\.to/);
assert.match(js,/min!==null&&max!==null&&min>max/);
assert.match(js,/syncOrderFilterSummary/);

console.log('owner orders mobile filter hierarchy contract OK');
