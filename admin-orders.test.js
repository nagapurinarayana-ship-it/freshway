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
assert.ok(js.includes("$('#liveOrdersTab').onclick=()=>{if(!testOrderMode){void loadOrders(true);return}setTestOrderMode(false);"),'Live orders tab must switch back from Test orders mode');
assert.ok(js.includes("$('#testOrdersTab').onclick=()=>{if(testOrderMode){void loadOrders(true);return}setTestOrderMode(true);"),'Test Orders must load only after the Owner explicitly selects that tab');
assert.match(js,/const TEST_ORDER_MODE_KEY='freshway-owner-test-orders-mode-v1'/,'Owner must use a stable key for the explicitly selected order tab');
assert.match(js,/function readTestOrderMode\(\)\{try\{return sessionStorage\.getItem\(TEST_ORDER_MODE_KEY\)==='1'\}catch\(_\)\{return false\}\}/,'refresh must restore the previously selected order tab safely');
assert.match(js,/testOrderMode=readTestOrderMode\(\)/,'initial order mode must be restored before loading the list');
assert.match(js,/sessionStorage\.setItem\(TEST_ORDER_MODE_KEY,testOrderMode\?'1':'0'\)/,'manual order-tab selection must persist across refresh');
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

// Dashboard shortcuts clear unrelated filters and show the newest matching orders.
assert.match(js,/kpi\('New orders',[\s\S]*?'first-new-order'\)/);
assert.match(js,/data-kpi-action="\$\{action\}"/);
assert.match(js,/function openFirstNewOrder\(\)/);
assert.match(js,/status:'New',sort:'newest'/);
assert.match(js,/\$\('#orderSort'\)\.value=sort/);
assert.match(js,/status:'Processing',sort:'newest'/);
assert.match(js,/processing-orders/);
assert.match(js,/today-deliveries/);
assert.match(js,/pending-cash/);
assert.match(lifecycle,/if\(!nextTest&&destination&&destination\.getAttribute\('aria-selected'\)!=='true'\)destination\.click\(\)/,'moving an order to Test Orders must not auto-select that tab');
assert.doesNotMatch(lifecycle,/if\(destination&&destination\.getAttribute\('aria-selected'\)!=='true'\)destination\.click\(\)/,'classification must not auto-select Test Orders');
assert.match(js,/navigateAdminScreen\('orders',\{historyMode:'push',deferOrdersLoad:true\}\)/);
assert.match(js,/target\.scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
assert.match(js,/while\(\(orderLoading\|\|orderLoadPending\)&&waitCount<120\)/,'New-orders shortcut must wait for an in-flight or queued order-list request before scrolling');
assert.match(js,/Orders are still loading\. Please try again\./,'Slow loading must not be reported as an empty queue');
assert.match(js,/Could not find the matching orders\. Refresh Orders and try again\./,'A load failure must not be reported as no pending orders');

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
assert.ok(html.includes('admin.css?v=20261027-delivery-offers-v2'),'Owner HTML must load the compact location-row styles');
assert.ok(html.includes('admin.js?v=20261029-order-shortcuts-v1'),'Owner HTML must load the cleaned order details');
const ownerSw=fs.readFileSync('admin/sw.js','utf8');
assert.ok(ownerSw.includes('fw-owner-v56'),'Owner PWA cache must advance for updated order detail assets');
assert.ok(html.includes('owner-lifecycle.js?v=20261029-test-order-manual-tab-v1'),'Owner HTML must load the cache-busted map fix');
assert.ok(ownerSw.includes('/admin/owner-lifecycle.js?v=20261029-test-order-manual-tab-v1'),'Owner PWA shell must cache the map fix');
assert.ok(ownerSw.includes('/admin/admin.css?v=20261027-delivery-offers-v2'),'Owner PWA shell must cache the current Owner CSS');
assert.ok(ownerSw.includes('/admin/admin.js?v=20261029-order-shortcuts-v1'),'Owner PWA shell must cache the current Owner JS');
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
