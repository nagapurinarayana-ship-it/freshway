import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const workerRoot = process.cwd();
const database = 'freshway';
const config = 'wrangler.jsonc';

function execute(sql) {
  if (!/^\s*SELECT\b/i.test(sql) || /;|\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA)\b/i.test(sql)) {
    throw new Error('Audit refused a non-read-only SQL statement.');
  }
  const raw = execFileSync('npx', [
    'wrangler', 'd1', 'execute', database, '--remote',
    '--config', config, '--command', sql, '--json'
  ], { cwd: workerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Wrangler did not return JSON for a read-only query.');
  return JSON.parse(raw.slice(start, end + 1));
}

function findRows(value, predicate) {
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof item === 'object') && value.some(predicate)) return value;
    for (const item of value) {
      const found = findRows(item, predicate);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'results' && Array.isArray(item)) {
        if (item.length === 0 || item.every(row => row && typeof row === 'object' && predicate(row))) return item;
        for (const nested of item) {
          const found = findRows(nested, predicate);
          if (found) return found;
        }
      }
      const found = findRows(item, predicate);
      if (found) return found;
    }
  }
  return null;
}

function rowsFor(sql, predicate, label) {
  const data = execute(sql);
  const rows = findRows(data, predicate);
  if (!rows) {
    // An empty result is valid for event and reservation tables. Required
    // baseline tables are checked separately below.
    const serialized = JSON.stringify(data);
    if (/error|exception/i.test(serialized)) throw new Error('D1 query failed for ' + label + ': ' + serialized.slice(0, 1000));
    return [];
  }
  return rows;
}

const stores = rowsFor(
  'SELECT id,name,latitude,longitude,service_radius_km,is_active FROM delivery_stores',
  row => 'id' in row && 'service_radius_km' in row, 'stores'
);
const orders = rowsFor(
  "SELECT o.id,o.created_at,o.delivery_status,o.payment_status,o.assigned_store_id,o.schedule_status,o.scheduled_slot_id," +
  "COALESCE(s.latitude,a.latitude) delivery_latitude,COALESCE(s.longitude,a.longitude) delivery_longitude," +
  "ds.id matched_store_id,ds.name assigned_store_name,ds.is_active assigned_store_active," +
  "(SELECT e.action FROM order_audit_events e WHERE e.order_id=o.id AND e.action IN ('delivery_date_requested','delivery_rescheduled_by_owner','delivery_rescheduled_by_customer','delivery_date_change_approved') ORDER BY e.id DESC LIMIT 1) latest_assignment_action," +
  "(SELECT CASE WHEN json_valid(e.after_json) THEN json_extract(e.after_json,'$.storeId') END FROM order_audit_events e WHERE e.order_id=o.id AND e.action IN ('delivery_date_requested','delivery_rescheduled_by_owner','delivery_rescheduled_by_customer','delivery_date_change_approved') ORDER BY e.id DESC LIMIT 1) latest_event_store_id " +
  "FROM orders o LEFT JOIN order_address_snapshots s ON s.order_id=o.id LEFT JOIN addresses a ON a.id=o.address_id " +
  "LEFT JOIN delivery_stores ds ON ds.id=o.assigned_store_id WHERE COALESCE(o.is_test_order,0)=0 ORDER BY o.created_at DESC",
  row => 'id' in row && 'assigned_store_id' in row && 'delivery_status' in row, 'orders'
);
const orderItems = rowsFor(
  'SELECT oi.order_id,oi.product_id,oi.qty,p.active product_active,p.stock_managed,c.active category_active ' +
  'FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id',
  row => 'order_id' in row && 'product_id' in row && 'qty' in row, 'order items'
);
const catalogueRows = rowsFor(
  'SELECT store_id,product_id,is_available FROM delivery_store_catalogue',
  row => 'store_id' in row && 'product_id' in row && 'is_available' in row, 'store catalogue'
);
const inventoryRows = rowsFor(
  "SELECT i.store_id,i.product_id,i.stock_quantity," +
  "COALESCE(SUM(CASE WHEN r.status IN ('reserved','conflict') THEN r.qty ELSE 0 END),0) reserved_qty " +
  'FROM delivery_store_inventory i LEFT JOIN delivery_store_inventory_reservations r ' +
  'ON r.store_id=i.store_id AND r.product_id=i.product_id GROUP BY i.store_id,i.product_id',
  row => 'store_id' in row && 'product_id' in row && 'stock_quantity' in row, 'store inventory'
);
const stockReservations = rowsFor(
  "SELECT order_id,store_id,product_id,qty,status FROM delivery_store_inventory_reservations WHERE status IN ('reserved','conflict')",
  row => 'order_id' in row && 'store_id' in row && 'product_id' in row && 'qty' in row, 'active stock reservations'
);
const slotReservations = rowsFor(
  "SELECT r.order_id,s.store_id,r.status FROM delivery_slot_reservations r " +
  "JOIN delivery_slots s ON s.id=r.slot_id WHERE r.status IN ('reserved','conflict')",
  row => 'order_id' in row && 'store_id' in row, 'active slot reservations'
);

if (!stores.length) throw new Error('Production D1 returned no stores; refusing to interpret this as a valid audit.');
if (!orders.length) throw new Error('Production D1 returned no non-test orders; verify the query/environment before accepting an empty audit.');
if (!orderItems.length) throw new Error('Production D1 returned no order items; refusing to calculate basket eligibility.');

const storeById = new Map(stores.map(store => [String(store.id), {
  id: String(store.id),
  name: String(store.name || ''),
  latitude: Number(store.latitude),
  longitude: Number(store.longitude),
  radius: Number(store.service_radius_km),
  active: Number(store.is_active) === 1
}]));
const itemsByOrder = new Map();
for (const item of orderItems) {
  const key = String(item.order_id);
  if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
  itemsByOrder.get(key).push({
    productId: String(item.product_id),
    qty: Number(item.qty),
    active: Number(item.product_active) === 1,
    categoryActive: Number(item.category_active) === 1,
    stockManaged: Number(item.stock_managed) === 1
  });
}
const catalogue = new Map(catalogueRows.map(row => [
  String(row.store_id) + '|' + String(row.product_id),
  Number(row.is_available) === 1
]));
const inventory = new Map(inventoryRows.map(row => [
  String(row.store_id) + '|' + String(row.product_id),
  { quantity: Number(row.stock_quantity || 0), reserved: Number(row.reserved_qty || 0) }
]));
const ownReservations = new Map();
for (const row of stockReservations) {
  const key = String(row.order_id) + '|' + String(row.store_id) + '|' + String(row.product_id);
  ownReservations.set(key, (ownReservations.get(key) || 0) + Number(row.qty || 0));
}
const stockReservationsByOrder = new Map();
for (const row of stockReservations) {
  const key = String(row.order_id);
  if (!stockReservationsByOrder.has(key)) stockReservationsByOrder.set(key, new Set());
  stockReservationsByOrder.get(key).add(String(row.store_id));
}
const slotReservationsByOrder = new Map();
for (const row of slotReservations) {
  const key = String(row.order_id);
  if (!slotReservationsByOrder.has(key)) slotReservationsByOrder.set(key, new Set());
  slotReservationsByOrder.get(key).add(String(row.store_id));
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
function validPin(order) {
  const lat = Number(order.delivery_latitude), lon = Number(order.delivery_longitude);
  return order.delivery_latitude !== null && order.delivery_latitude !== '' &&
    order.delivery_longitude !== null && order.delivery_longitude !== '' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}
function withinRadius(order, store) {
  if (!validPin(order) || !store || !store.active) return false;
  return distanceKm(Number(order.delivery_latitude), Number(order.delivery_longitude),
    store.latitude, store.longitude) <= store.radius;
}
function basketFits(order, store) {
  const items = itemsByOrder.get(String(order.id)) || [];
  if (!items.length || items.some(item => !item.active || !item.categoryActive)) return false;
  return items.every(item => {
    // Runtime catalogue initialisation creates a missing store/product row with
    // is_available=1. This audit models that default without writing it.
    if (catalogue.has(store.id + '|' + item.productId) && catalogue.get(store.id + '|' + item.productId) !== true) return false;
    if (!item.stockManaged) return true;
    const key = store.id + '|' + item.productId;
    const stock = inventory.get(key);
    if (!stock) return false;
    // Exclude this order's own reservation to reconstruct the available quantity
    // at checkout/rescheduling time; all other active reservations remain deducted.
    const own = ownReservations.get(String(order.id) + '|' + key.replace('|', '|')) || 0;
    return stock.quantity - stock.reserved + own >= item.qty;
  });
}
function eligibleStoresNow(order) {
  return [...storeById.values()]
    .filter(store => withinRadius(order, store) && basketFits(order, store))
    .sort((a, b) => distanceKm(Number(order.delivery_latitude), Number(order.delivery_longitude), a.latitude, a.longitude) -
      distanceKm(Number(order.delivery_latitude), Number(order.delivery_longitude), b.latitude, b.longitude) ||
      a.name.localeCompare(b.name));
}
const isActiveOrder = order => !['cancelled', 'delivered'].includes(String(order.delivery_status || '').trim().toLowerCase());

const findings = {
  totalProductionOrders: orders.length,
  ordersWithAssignedStore: 0,
  ordersWithoutAssignedStore: 0,
  activeOrdersWithoutAssignedStore: 0,
  ordersWithAddressCoordinates: 0,
  ordersMissingAddressCoordinates: 0,
  assignedStoreNotFound: 0,
  assignedStoreInactiveNow: 0,
  assignedStoreOutsideCurrentRadius: 0,
  assignmentAuditEventsPresent: 0,
  assignmentAuditStoreMismatch: 0,
  activeOrdersNotFulfillableAtAssignedStoreNow: 0,
  activeOrdersPotentiallyFulfillableAtAnotherStoreNow: 0,
  activeAssignedOrdersAtNearestEligibleStoreNow: 0,
  activeAssignedOrdersNotAtNearestEligibleStoreNow: 0,
  activeStockReservationStoreMismatch: 0,
  activeSlotReservationStoreMismatch: 0,
  ordersWithMultipleActiveStockReservationStores: 0,
  ordersWithMultipleActiveSlotReservationStores: 0
};
const storeCounts = new Map();
const activeAssignedRouteChecks = [];
const issues = [];

for (const order of orders) {
  const orderId = String(order.id);
  const statusActive = isActiveOrder(order);
  const assignedId = order.assigned_store_id == null || order.assigned_store_id === '' ? '' : String(order.assigned_store_id);
  const assignedStore = assignedId ? storeById.get(assignedId) : null;
  const itemStoreIds = stockReservationsByOrder.get(orderId) || new Set();
  const slotStoreIds = slotReservationsByOrder.get(orderId) || new Set();

  if (assignedId) {
    findings.ordersWithAssignedStore++;
    const key = assignedStore?.name || 'Unknown assigned store';
    storeCounts.set(key, (storeCounts.get(key) || 0) + 1);
  } else {
    findings.ordersWithoutAssignedStore++;
    if (statusActive) {
      findings.activeOrdersWithoutAssignedStore++;
      issues.push('active_order_without_assigned_store');
    }
  }

  const hasPin = validPin(order);
  if (hasPin) findings.ordersWithAddressCoordinates++;
  else findings.ordersMissingAddressCoordinates++;

  if (assignedId && !assignedStore) {
    findings.assignedStoreNotFound++;
    if (statusActive) issues.push('active_order_assigned_store_not_found');
  } else if (assignedStore && statusActive) {
    if (!assignedStore.active) {
      findings.assignedStoreInactiveNow++;
      issues.push('active_order_assigned_store_inactive');
    }
    if (hasPin && !withinRadius(order, assignedStore)) {
      findings.assignedStoreOutsideCurrentRadius++;
      issues.push('active_order_address_outside_assigned_store_radius');
    }
  }

  if (order.latest_assignment_action) {
    findings.assignmentAuditEventsPresent++;
    if (order.latest_assignment_action === 'delivery_date_change_approved') {
      // The existing owner flow explicitly clears assigned_store_id on approval
      // of a delivery-date-only request; the order needs a later store schedule.
      if (assignedId) {
        findings.assignmentAuditStoreMismatch++;
        if (statusActive) issues.push('order_store_not_cleared_after_date_change_approval');
      }
    } else if (order.latest_event_store_id == null) {
      findings.assignmentAuditStoreMismatch++;
      if (statusActive) issues.push('assignment_audit_missing_store_id');
    } else if (String(order.latest_event_store_id) !== assignedId) {
      findings.assignmentAuditStoreMismatch++;
      if (statusActive) issues.push('order_assignment_differs_from_latest_assignment_audit');
    }
  }

  if (statusActive && assignedId) {
    const stockStoreMismatch = [...itemStoreIds].some(id => id !== assignedId);
    const slotStoreMismatch = [...slotStoreIds].some(id => id !== assignedId);
    if (stockStoreMismatch) {
      findings.activeStockReservationStoreMismatch++;
      issues.push('active_stock_reservation_store_differs_from_order');
    }
    if (slotStoreMismatch) {
      findings.activeSlotReservationStoreMismatch++;
      issues.push('active_slot_reservation_store_differs_from_order');
    }
  }
  if (itemStoreIds.size > 1) findings.ordersWithMultipleActiveStockReservationStores++;
  if (slotStoreIds.size > 1) findings.ordersWithMultipleActiveSlotReservationStores++;

  if (statusActive && assignedId && assignedStore && hasPin) {
    const eligible = eligibleStoresNow(order);
    const assignedIsEligible = eligible.some(store => store.id === assignedId);
    if (!assignedIsEligible) {
      findings.activeOrdersNotFulfillableAtAssignedStoreNow++;
      issues.push('active_order_basket_not_fulfillable_at_assigned_store_now');
      if (eligible.some(store => store.id !== assignedId)) findings.activeOrdersPotentiallyFulfillableAtAnotherStoreNow++;
    }
    const nearestEligible = eligible[0] || null;
    const distanceToAssigned = distanceKm(Number(order.delivery_latitude), Number(order.delivery_longitude),
      assignedStore.latitude, assignedStore.longitude);
    const assignedIsNearestEligible = !!nearestEligible && nearestEligible.id === assignedId;
    if (assignedIsNearestEligible) findings.activeAssignedOrdersAtNearestEligibleStoreNow++;
    else findings.activeAssignedOrdersNotAtNearestEligibleStoreNow++;
    activeAssignedRouteChecks.push({
      orderDate: String(order.created_at || '').slice(0, 10),
      status: String(order.delivery_status || ''),
      assignedStore: assignedStore.name,
      distanceToAssignedStoreKm: Math.round(distanceToAssigned * 100) / 100,
      assignedStoreCurrentlyFitsBasket: assignedIsEligible,
      nearestCurrentlyEligibleStore: nearestEligible?.name || null,
      distanceToNearestEligibleStoreKm: nearestEligible
        ? Math.round(distanceKm(Number(order.delivery_latitude), Number(order.delivery_longitude),
          nearestEligible.latitude, nearestEligible.longitude) * 100) / 100
        : null,
      assignedStoreIsNearestEligible: assignedIsNearestEligible
    });
  }
}

const groupBy = (rows, keyOf) => {
  const counts = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};
const activeUnassigned = orders.filter(order => isActiveOrder(order) && !order.assigned_store_id);
const activeUnassignedBreakdown = groupBy(activeUnassigned, order => [
  String(order.created_at || '').slice(0, 10) || 'unknown-date',
  String(order.delivery_status || 'unknown-status'),
  String(order.schedule_status || 'unknown-schedule'),
  String(order.latest_assignment_action || 'no-assignment-audit-event'),
  order.latest_event_store_id == null ? 'audit-store-id-missing' : 'audit-store-id-present',
  validPin(order) ? 'has-map-pin' : 'no-map-pin'
].join(' | '));
const activeOrdersByDateAndAssignment = groupBy(orders.filter(isActiveOrder), order => [
  String(order.created_at || '').slice(0, 10) || 'unknown-date',
  order.assigned_store_id ? 'assigned' : 'unassigned'
].join(' | '));
const assignedOrderDates = orders.filter(order => order.assigned_store_id).map(order => String(order.created_at || '')).filter(Boolean).sort();
const assignmentAuditDates = orders.filter(order => order.latest_assignment_action).map(order => String(order.created_at || '')).filter(Boolean).sort();

const report = {
  audit: 'read-only-production-order-store-routing',
  generatedAt: new Date().toISOString(),
  environment: 'Cloudflare D1 production database (freshway)',
  method: 'SELECT-only comparison of saved order assignment, latest assignment audit event, recorded address coordinates, current store radius, and active reservation ownership.',
  caveats: [
    'Current store coordinates, active flags, catalogue visibility and stock are compared with historical orders; a mismatch in current eligibility may reflect legitimate changes after checkout.',
    'Orders without a store assignment or delivery pin may predate store-based fulfilment or may need operational review; creation time and status should be considered.',
    'This audit does not create, update, cancel, delete, reschedule or otherwise mutate orders, reservations, customers, stores or stock.'
  ],
  findings,
  orderCountsByAssignedStore: Object.fromEntries([...storeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  activeAssignedRouteChecks,
  activeOrdersWithoutStoreOrAddressPin: orders.filter(order => isActiveOrder(order) &&
    (!order.assigned_store_id || !validPin(order))).length,
  activeUnassignedBreakdown,
  activeOrdersByDateAndAssignment,
  assignedOrderDateRange: assignedOrderDates.length ? { first: assignedOrderDates[0], latest: assignedOrderDates.at(-1) } : null,
  assignmentAuditOrderDateRange: assignmentAuditDates.length ? { first: assignmentAuditDates[0], latest: assignmentAuditDates.at(-1) } : null,
  status: issues.length ? 'REVIEW_REQUIRED' : 'NO_CURRENT_ROUTING_INCONSISTENCIES_DETECTED',
  issueCount: issues.length,
  issueCategories: [...new Set(issues)].sort()
};

const summary = [
  '# FreshWay production order-to-store audit',
  '',
  '- Generated: ' + report.generatedAt,
  '- Environment: production D1; read-only SELECT queries only',
  '- Result: **' + report.status + '**',
  '',
  '## Findings',
  '',
  '| Check | Count |',
  '|---|---:|',
  ...Object.entries(findings).map(([key, value]) => '| ' + key + ' | ' + value + ' |'),
  '',
  '## Orders by assigned store',
  '',
  '| Store | Orders |',
  '|---|---:|',
  ...Object.entries(report.orderCountsByAssignedStore).map(([name, count]) => '| ' + name.replace(/\|/g, '/') + ' | ' + count + ' |'),
  '',
  '## Active assigned orders: route checks',
  '',
  '| Order date | Status | Assigned store | Distance (km) | Basket currently fits | Nearest eligible store | Nearest distance (km) | Assigned is nearest |',
  '|---|---|---|---:|---|---|---:|---|',
  ...report.activeAssignedRouteChecks.map(row => '| ' + [
    row.orderDate,row.status,row.assignedStore,row.distanceToAssignedStoreKm,
    row.assignedStoreCurrentlyFitsBasket ? 'Yes' : 'No',
    row.nearestCurrentlyEligibleStore || 'None',
    row.distanceToNearestEligibleStoreKm ?? '—',
    row.assignedStoreIsNearestEligible ? 'Yes' : 'No'
  ].join(' | ') + ' |'),
  '',
  '## Active unassigned order breakdown',
  '',
  '| Date | Status / schedule / assignment-audit / location | Count |',
  '|---|---|---:|',
  ...Object.entries(report.activeUnassignedBreakdown).map(([key, count]) => {
    const parts = key.split(' | ');
    return '| ' + parts.shift() + ' | ' + parts.join('; ') + ' | ' + count + ' |';
  }),
  '',
  '## Issue categories',
  '',
  ...(report.issueCategories.length ? report.issueCategories.map(issue => '- ' + issue) : ['- None detected']),
  '',
  '## Interpretation notes',
  ...report.caveats.map(note => '- ' + note),
  '',
  'No customer names, phone numbers, house/area text or exact coordinates are included in this report.'
].join('\n');

console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
if (issues.length) process.exitCode = 1;
