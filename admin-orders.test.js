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
assert.match(lifecycle,/order-map-row/);
assert.match(lifecycle,/Map pin saved/);
assert.doesNotMatch(lifecycle,/Exact delivery location/);
assert.doesNotMatch(lifecycle,/modalExactMap/);
assert.match(lifecycle,/id="modalDeliveryMap"/);
assert.match(lifecycle,/bindLifecycle\(o,prev,nextId,hasCoords,mapQuery\)/,'Open map must receive the map query when lifecycle handlers are bound');
assert.match(lifecycle,/function bindLifecycle\(o,prev,nextId,hasCoords,mapQuery\)/,'Map click handler must use a query passed into its scope');
assert.match(lifecycle,/seenAddressParts/);
assert.match(lifecycle,/addressParts\.join\(', '\)/);

assert.match(js,/function validateOrderFilters/);
assert.match(js,/orderAdvancedFilters/);
assert.match(js,/orderAdvancedCount/);
assert.match(js,/orderFilterHint/);
assert.match(js,/f\.from&&f\.to&&f\.from>f\.to/);
assert.match(js,/min!==null&&max!==null&&min>max/);
assert.match(js,/syncOrderFilterSummary/);

// The Overview "New orders" KPI must take the Owner to the oldest pending order,
// clear unrelated filters, and scroll that order card into view without changing
// how the other KPI cards navigate.
assert.match(js,/kpi\('New orders',[\s\S]*?'first-new-order'\)/);
assert.match(js,/data-kpi-action="\$\{action\}"/);
assert.match(js,/async function openFirstNewOrder\(\)/);
assert.match(js,/\$\('#orderStatus'\)\.value='New'/);
assert.match(js,/\$\('#orderSort'\)\.value='oldest'/);
assert.match(js,/navigateAdminScreen\('orders',\{historyMode:'push',deferOrdersLoad:true\}\)/);
assert.match(js,/target\.scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
assert.match(js,/while\(\(orderLoading\|\|orderLoadPending\)&&waitCount<120\)/,'New-orders shortcut must wait for an in-flight or queued order-list request before scrolling');
assert.match(js,/Orders are still loading\. Please try again\./,'Slow loading must not be reported as an empty queue');
assert.match(js,/Could not find the first pending order\. Refresh Orders and try again\./,'A load failure must not be reported as no pending orders');

assert.match(js,/data-kpi-action="first-new-order"/);
assert.match(js,/function navigateAdminScreen\(id,\{historyMode='push',deferOrdersLoad=false\}=\{\}\)/);



assert.match(js,/Registered mobile/);
assert.match(js,/Delivery contact/);
assert.match(js,/registeredPhone/);
assert.ok(js.includes("o.address?.deliveryPhone||o.customer?.deliveryPhone"));

console.log('owner order account-vs-delivery identity contract OK');
console.log('owner orders mobile filter hierarchy contract OK');


assert.match(js,/order-map-row/);
assert.match(js,/Map pin saved/);
assert.match(js,/Map pin unavailable/);
assert.match(js,/id="modalDeliveryMap"/);
assert.doesNotMatch(js,/Exact delivery location/);
assert.doesNotMatch(js,/modalExactMap/);
assert.doesNotMatch(js,/data-map-text/);
assert.match(js,/const addressText = addressParts\.join\(', '\)/);
assert.match(css,/\.order-map-row/);
assert.match(css,/\.order-map-status/);
assert.match(css,/\.order-map-link/);
assert.ok(html.includes('admin.css?v=20261027-owner-simple-v1'),'Owner HTML must load the compact location-row styles');
assert.ok(html.includes('admin.js?v=20261027-owner-simple-v1'),'Owner HTML must load the cleaned order details');
const ownerSw=fs.readFileSync('admin/sw.js','utf8');
assert.ok(ownerSw.includes('fw-owner-v48'),'Owner PWA cache must advance for updated order detail assets');
assert.ok(html.includes('owner-lifecycle.js?v=20261027-owner-delivery-date-v1'),'Owner HTML must load the cache-busted map fix');
assert.ok(ownerSw.includes('/admin/owner-lifecycle.js?v=20261027-owner-delivery-date-v1'),'Owner PWA shell must cache the map fix');
assert.ok(ownerSw.includes('/admin/admin.css?v=20261027-owner-simple-v1'),'Owner PWA shell must cache the current Owner CSS');
assert.ok(ownerSw.includes('/admin/admin.js?v=20261027-owner-simple-v1'),'Owner PWA shell must cache the current Owner JS');
assert.ok(html.includes('frontend/admin/order-alerts.js?v=20261021-owner-push-diagnostics-v1'),'Owner HTML must load the login-aware push setup');
assert.ok(ownerSw.includes('/admin/frontend/admin/order-alerts.js?v=20261021-owner-push-diagnostics-v1'),'Owner PWA shell must cache the login-aware push setup');


assert.match(lifecycle,/id="fwLifeDeliveryDate"/);
assert.match(lifecycle,/data-life-save-date/);
assert.ok(lifecycle.includes("/admin/delivery/orders/"));
assert.ok(lifecycle.includes("'/schedule'"));
assert.match(lifecycle,/deliveryDate:requestedDate/);
assert.match(lifecycle,/The customer will see this date on My Orders/);
const customerOrderActions=fs.readFileSync('frontend/customer/order-actions.js','utf8');
const customerOrderData=fs.readFileSync('frontend/customer/orders-data.js','utf8');
const customerApp=fs.readFileSync('app.js','utf8');
assert.match(customerOrderActions,/result\.alreadyCancelled/);
assert.match(customerOrderActions,/status:'Cancelled'/);
assert.match(customerOrderActions,/silentError:true/);
assert.match(customerOrderData,/options\.silentError/);
assert.match(customerApp,/customerOrderData\.load\(\{silentError:event\.detail\?\.silentError===true\}\)/);

console.log('Owner order map UI stays compact, accessible and does not expose raw coordinates');
console.log('Owner address display deduplicates repeated legacy address fields without modifying saved data');
