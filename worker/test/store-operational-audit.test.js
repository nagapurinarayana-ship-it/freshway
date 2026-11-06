import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoreOperationalAudit,
  renderStoreOperationalAuditMarkdown
} from '../scripts/store-operational-audit.mjs';

const products = [
  { id: 'oil', name: 'Groundnut Oil', managed: 1, productActive: 1, categoryActive: 1, isAvailable: 1, central: 399, override: 400, onHand: 10, reserved: 2, threshold: 5 },
  { id: 'rice', name: 'HMT Rice', managed: 1, productActive: 1, categoryActive: 1, isAvailable: 1, central: 100, override: null, onHand: 3, reserved: 1, threshold: 5 },
  { id: 'out', name: 'Out of Stock Oil', managed: 1, productActive: 1, categoryActive: 1, isAvailable: 1, central: 200, override: null, onHand: 0, reserved: 0, threshold: 5 },
  { id: 'hidden', name: 'Hidden Category Rice', managed: 1, productActive: 1, categoryActive: 0, isAvailable: 1, central: 70, override: 75, onHand: 4, reserved: 0, threshold: 2 },
  { id: 'disabled', name: 'Disabled Store Product', managed: 1, productActive: 1, categoryActive: 1, isAvailable: 0, central: 150, override: null, onHand: 8, reserved: 0, threshold: 2 }
];

function makeMatrix(storeId, name, isActive) {
  return products.map(product => ({
    store_id: storeId, store_name: name, store_active: isActive,
    latitude: 17.385044, longitude: 78.486671, service_radius_km: 5,
    product_id: product.id, product_name: product.name, unit: 'unit',
    central_price: product.central, product_active: product.productActive,
    category_id: 'cat', category_name: 'Pantry', category_active: product.categoryActive,
    stock_managed: product.managed, low_stock_threshold: product.threshold,
    catalogue_store_id: storeId, store_product_available: product.isAvailable,
    price_override: product.override,
    effective_price: product.override ?? product.central,
    inventory_store_id: storeId, on_hand: product.onHand,
    reserved_qty: product.reserved, available_qty: Math.max(0, product.onHand - product.reserved)
  }));
}

const fullMatrix = [
  ...makeMatrix('store-a', 'Store A', 1),
  ...makeMatrix('store-b', 'Store B', 0)
];

test('audits all active and inactive stores, full catalogue/inventory matrix, prices and stock states', () => {
  const report = buildStoreOperationalAudit(fullMatrix);
  assert.equal(report.healthy, true);
  assert.equal(report.summary.storeCount, 2);
  assert.equal(report.summary.activeStores, 1);
  assert.equal(report.summary.inactiveStores, 1);
  assert.equal(report.summary.productCount, 5);
  assert.equal(report.summary.missingCatalogueRows, 0);
  assert.equal(report.summary.missingInventoryRows, 0);
  assert.equal(report.summary.invalidPriceRows, 0);

  const storeA = report.stores.find(store => store.id === 'store-a');
  assert.equal(storeA.catalogueRows, 5);
  assert.equal(storeA.inventoryRows, 5);
  assert.equal(storeA.customerVisibleProducts, 2);
  assert.equal(storeA.localPriceOverrides.length, 2);
  assert.equal(storeA.localPriceOverrides.find(item => item.product === 'Groundnut Oil').storePrice, 400);
  assert.equal(storeA.hiddenByCentralCatalogue, 1);
  assert.equal(storeA.locallyDisabledProducts, 1);
  assert.equal(storeA.lowStock.length, 1);
  assert.equal(storeA.lowStock[0].product, 'HMT Rice');
  assert.equal(storeA.lowStock[0].available, 2);
  assert.equal(storeA.outOfStock.length, 1);
  assert.equal(storeA.outOfStock[0].product, 'Out of Stock Oil');

  const storeB = report.stores.find(store => store.id === 'store-b');
  assert.equal(storeB.active, false);
  assert.equal(storeB.customerVisibleProducts, 0);
  assert.equal(storeB.lowStock.length, 1);
});

test('missing per-store catalogue or stock rows are critical, never treated as zero healthy inventory', () => {
  const broken = fullMatrix.map(row => ({ ...row }));
  broken.find(row => row.store_id === 'store-a' && row.product_id === 'oil').catalogue_store_id = null;
  broken.find(row => row.store_id === 'store-b' && row.product_id === 'rice').inventory_store_id = null;
  const report = buildStoreOperationalAudit(broken);
  assert.equal(report.healthy, false);
  assert.equal(report.summary.missingCatalogueRows, 1);
  assert.equal(report.summary.missingInventoryRows, 1);
  assert.ok(report.criticalIssues.some(issue => issue.includes('missing store catalogue rows')));
  assert.ok(report.criticalIssues.some(issue => issue.includes('missing store inventory rows')));
});

test('active orders without a live store and mismatched or split stock reservations are critical', () => {
  const orders = [
    { order_id: 'FW-1', delivery_status: 'Processing', assigned_store_id: 'store-b', assigned_store_name: 'Store B', assigned_store_active: 0 },
    { order_id: 'FW-2', delivery_status: 'New', assigned_store_id: null, assigned_store_name: null, assigned_store_active: 0 }
  ];
  const reservations = [
    { order_id: 'FW-1', delivery_status: 'Processing', assigned_store_id: 'store-b', product_id: 'oil',
      product_name: 'Groundnut Oil', expected_reserved_qty: 2, actual_reserved_qty: 1,
      actual_store_count: 2, actual_store_ids: 'store-a,store-b' }
  ];
  const report = buildStoreOperationalAudit(fullMatrix, orders, reservations);
  assert.equal(report.healthy, false);
  assert.equal(report.summary.activeOrdersOnUnavailableStores, 2);
  assert.equal(report.summary.reservationMismatches, 1);
  assert.equal(report.summary.multiStoreReservationOrders, 1);
  assert.ok(report.criticalIssues.some(issue => issue.includes('active orders have no active assigned store')));
  assert.ok(report.criticalIssues.some(issue => issue.includes('stock reservation inconsistencies')));
});

test('rejects empty D1 matrix and catches invalid active-store coordinates and prices', () => {
  assert.throws(() => buildStoreOperationalAudit([]), /no store\/product rows/i);
  const invalid = fullMatrix.map(row => ({ ...row }));
  const oil = invalid.find(row => row.store_id === 'store-a' && row.product_id === 'oil');
  oil.latitude = 99;
  oil.price_override = 400.5;
  oil.effective_price = 400.5;
  const report = buildStoreOperationalAudit(invalid);
  assert.equal(report.summary.invalidStoreConfigurations, 1);
  assert.equal(report.summary.invalidPriceRows, 1);
  assert.equal(report.healthy, false);
});

test('renders a store-by-store audit summary with explicit local prices and low/out stock', () => {
  const report = buildStoreOperationalAudit(fullMatrix);
  const markdown = renderStoreOperationalAuditMarkdown(report);
  assert.match(markdown, /Store A \(Active\)/);
  assert.match(markdown, /Store B \(Inactive\)/);
  assert.match(markdown, /central ₹399, store ₹400/);
  assert.match(markdown, /LOW: HMT Rice/);
  assert.match(markdown, /OUT: Out of Stock Oil/);
  assert.match(markdown, /None detected/);
});


test('diagnoses unassigned baskets against pin radius, store visibility and full-basket stock without exposing coordinates', () => {
  const orders = [
    {
      order_id: 'FW-CANDIDATE', created_at: '2026-11-01 10:00:00',
      delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow',
      location_latitude: 17.385044, location_longitude: 78.486671, location_source: 'order_snapshot',
      items_json: JSON.stringify([{ productId: 'oil', name: 'Groundnut Oil', qty: 2, stockReservedQty: 2 }])
    },
    {
      order_id: 'FW-NO-PIN', created_at: '2026-10-01 10:00:00',
      delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow',
      location_latitude: null, location_longitude: null, location_source: 'missing',
      items_json: JSON.stringify([{ productId: 'oil', name: 'Groundnut Oil', qty: 1, stockReservedQty: 1 }])
    },
    {
      order_id: 'FW-NO-RADIUS', created_at: '2026-11-05 10:00:00',
      delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow',
      location_latitude: -40, location_longitude: 100, location_source: 'address_record',
      items_json: JSON.stringify([{ productId: 'oil', name: 'Groundnut Oil', qty: 1, stockReservedQty: 1 }])
    },
    {
      order_id: 'FW-NO-STOCK', created_at: '2026-11-05 10:00:00',
      delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow',
      location_latitude: 17.385044, location_longitude: 78.486671, location_source: 'order_snapshot',
      items_json: JSON.stringify([{ productId: 'out', name: 'Out of Stock Oil', qty: 1, stockReservedQty: 1 }])
    }
  ];
  const report = buildStoreOperationalAudit(fullMatrix, orders);
  const byId = new Map(report.orderDiagnostics.map(order => [order.orderId, order]));

  assert.equal(byId.get('FW-CANDIDATE').diagnosis, 'eligible-store-found-assignment-needs-manual-review');
  assert.deepEqual(byId.get('FW-CANDIDATE').fulfilmentStores, ['Store A']);
  assert.equal(byId.get('FW-CANDIDATE').ageDays >= 0, true);
  assert.equal(byId.get('FW-CANDIDATE').items[0].quantity, 2);

  assert.equal(byId.get('FW-NO-PIN').diagnosis, 'missing-delivery-pin');
  assert.equal(byId.get('FW-NO-PIN').locationPinAvailable, false);
  assert.equal(byId.get('FW-NO-RADIUS').diagnosis, 'no-active-store-within-delivery-radius');
  assert.equal(byId.get('FW-NO-STOCK').diagnosis, 'no-single-in-radius-store-can-fulfil-whole-basket');
  assert.equal(byId.get('FW-NO-STOCK').storeAssessments[0].blockers[0].reason, 'insufficient-stock');

  const markdown = renderStoreOperationalAuditMarkdown(report);
  assert.match(markdown, /Unassigned-order fulfilment diagnosis/);
  assert.match(markdown, /FW-NO-PIN.*pin missing/);
  assert.doesNotMatch(JSON.stringify(report.orderDiagnostics), /17\.385044|78\.486671/);
});


test('shows whether a date-only reschedule was the last store action, while preserving later reassignment history', () => {
  const orders = [
    {
      order_id: 'FW-DATE-ONLY', created_at: '2026-11-01 10:00:00',
      delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow',
      location_latitude: 17.385044, location_longitude: 78.486671, location_source: 'order_snapshot',
      items_json: JSON.stringify([{ productId: 'oil', name: 'Groundnut Oil', qty: 1, stockReservedQty: 1 }])
    },
    {
      order_id: 'FW-REASSIGNED', created_at: '2026-11-01 10:00:00',
      delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow',
      location_latitude: 17.385044, location_longitude: 78.486671, location_source: 'order_snapshot',
      items_json: JSON.stringify([{ productId: 'oil', name: 'Groundnut Oil', qty: 1, stockReservedQty: 1 }])
    }
  ];
  const history = [
    {
      order_id: 'FW-DATE-ONLY', event_created_at: '2026-11-02 10:00:00',
      actor_type: 'owner', action: 'delivery_date_change_approved',
      after_date: '2026-11-04', request_states: 'reschedule:approved:2026-11-04'
    },
    {
      order_id: 'FW-REASSIGNED', event_created_at: '2026-11-02 10:00:00',
      actor_type: 'owner', action: 'delivery_date_change_approved',
      after_date: '2026-11-04'
    },
    {
      order_id: 'FW-REASSIGNED', event_created_at: '2026-11-02 11:00:00',
      actor_type: 'owner', action: 'fulfilment_store_reassigned',
      after_store_id: 'store-a', after_store_name: 'Store A'
    }
  ];
  const report = buildStoreOperationalAudit(fullMatrix, orders, [], history);
  const byId = new Map(report.orderDiagnostics.map(order => [order.orderId, order]));

  assert.equal(byId.get('FW-DATE-ONLY').lastAssignmentEvent.action, 'delivery_date_change_approved');
  assert.equal(byId.get('FW-DATE-ONLY').likelyUnassignmentCause, 'approved-date-only-reschedule-cleared-store-assignment');
  assert.equal(byId.get('FW-DATE-ONLY').history[0].requestStates, 'reschedule:approved:2026-11-04');
  assert.equal(byId.get('FW-REASSIGNED').lastAssignmentEvent.action, 'fulfilment_store_reassigned');
  assert.equal(byId.get('FW-REASSIGNED').likelyUnassignmentCause, 'store-assignment-event-recorded-needs-follow-up-review');
  assert.equal(report.summary.ordersWithDateChangeApprovalAsLastStoreAction, 1);
  assert.equal(report.summary.ordersWithNoStoreAssignmentEvent, 0);
  assert.match(renderStoreOperationalAuditMarkdown(report), /delivery_date_change_approved/);
});
