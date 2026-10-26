import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceKm, parseTimeMinutes, formatTimeMinutes, handleCustomerDeliveryRequest, prepareCheckoutDelivery } from '../src/delivery-scheduling.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function envWithSettings(settings) {
  return { DB: { prepare(sql) { const query = { bind() { return { async first() { return sql.includes('FROM delivery_scheduling_settings') ? settings : null; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 1 } }; } }; }, async first() { return settings; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 1 } }; } }; return query; } } };
}

test('time windows parse strict 24-hour times and reject malformed values', () => {
  assert.equal(parseTimeMinutes('00:00'), 0);
  assert.equal(parseTimeMinutes('09:30'), 570);
  assert.equal(parseTimeMinutes('23:59'), 1439);
  assert.equal(parseTimeMinutes('24:00'), null);
  assert.equal(parseTimeMinutes('9:30'), null);
  assert.equal(parseTimeMinutes('12:60'), null);
  assert.equal(formatTimeMinutes(600), '10:00');
  assert.equal(formatTimeMinutes(1440), '24:00');
});

test('store distance uses a bounded Haversine distance and rejects invalid coordinates', () => {
  assert.equal(distanceKm(0, 0, 0, 0), 0);
  const hyderabadToSecunderabad = distanceKm(17.385, 78.4867, 17.4399, 78.4983);
  assert.ok(hyderabadToSecunderabad > 5 && hyderabadToSecunderabad < 7);
  assert.equal(distanceKm(91, 0, 0, 0), null);
  assert.equal(distanceKm(0, 181, 0, 0), null);
});


test('delivery slot endpoint stays safely disabled until Owner configures scheduling', async () => {
  const env = envWithSettings({ id: 1, enabled: 0, booking_horizon_days: 7, same_day_cutoff_minutes: 120, timezone: 'Asia/Kolkata' });
  const request = new Request('https://freshway.example/api/delivery/slots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-10-27', items: [{ id: 'rice', qty: 1 }], address: {} })
  });
  const response = await handleCustomerDeliveryRequest(request, env, '');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.enabled, false);
  assert.deepEqual(body.slots, []);
});

test('checkout cannot bypass an enabled delivery-slot requirement', async () => {
  const env = envWithSettings({ id: 1, enabled: 1, booking_horizon_days: 7, same_day_cutoff_minutes: 120, timezone: 'Asia/Kolkata' });
  await assert.rejects(
    () => prepareCheckoutDelivery(env, { address: {} }, [{ id: 'rice', qty: 1 }]),
    /Choose an available delivery date and time window/i
  );
});

test('numbered migration contains every delivery table, order field and concurrency trigger', () => {
  const migration = read('../migrations/0037_order_delivery_scheduling.sql');
  const schema = read('../schema.sql');
  for (const field of [
    'scheduled_delivery_date', 'scheduled_slot_id', 'assigned_store_id',
    'scheduled_start_minute', 'scheduled_end_minute', 'schedule_status'
  ]) {
    assert.match(migration, new RegExp('ALTER TABLE orders ADD COLUMN ' + field));
    assert.ok(schema.includes(field), 'baseline schema missing ' + field);
  }
  for (const table of [
    'delivery_scheduling_settings', 'delivery_stores', 'delivery_store_inventory',
    'delivery_slots', 'delivery_slot_reservations', 'delivery_store_inventory_reservations',
    'order_action_requests', 'order_audit_events', 'order_operational_flags'
  ]) {
    assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS ' + table), 'migration missing table ' + table);
    assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS ' + table), 'baseline missing table ' + table);
  }
  for (const trigger of [
    'delivery_slot_capacity_before_insert', 'delivery_slot_capacity_before_update',
    'delivery_store_stock_before_insert', 'delivery_store_stock_before_update'
  ]) {
    assert.ok(migration.includes('CREATE TRIGGER IF NOT EXISTS ' + trigger), 'migration missing concurrency guard ' + trigger);
    assert.ok(schema.includes('CREATE TRIGGER IF NOT EXISTS ' + trigger), 'baseline missing concurrency guard ' + trigger);
  }
});

test('customer checkout and My Orders UI are wired to server-authoritative delivery slots and authenticated actions', () => {
  const html = read('../../index.html');
  const app = read('../../app.js');
  const picker = read('../../frontend/customer/delivery-booking.js');
  const actions = read('../../frontend/customer/order-actions.js');
  const orders = read('../../frontend/customer/orders-view.js');
  const auth = read('../src/passcode-auth.js');
  assert.ok(html.includes('frontend/customer/delivery-booking.js'));
  assert.ok(html.includes('frontend/customer/order-actions.js'));
  assert.ok(app.includes('FreshWayCustomerDeliveryBookingInstance'));
  assert.ok(app.includes('freshway:order-actions-changed'));
  assert.ok(picker.includes("api('/api/delivery/slots'"));
  assert.ok(actions.includes('/cancel'));
  assert.ok(actions.includes('/reschedule'));
  assert.ok(actions.includes('/request'));
  assert.ok(orders.includes('data-customer-order-cancel'));
  assert.ok(orders.includes('data-customer-order-reschedule'));
  assert.ok(auth.includes('sessionCustomerId(request, env)'));
  assert.ok(auth.includes('handleCustomerDeliveryRequest(request, env, deliveryCustomerId)'));
});

test('Owner delivery UI prevents duplicate delegated handlers and requires reasoned manual overrides', () => {
  const html = read('../../admin.html');
  const js = read('../../frontend/admin/delivery-management.js');
  assert.ok(html.includes('frontend/admin/delivery-management.js'));
  assert.ok(js.includes('if(!root.dataset.fwDeliveryClickBound)'));
  assert.ok(js.includes('panel.dataset.orderId=orderId'));
  assert.ok(js.includes('Manual date and time must be saved as an Owner override'));
  assert.ok(js.includes('/admin/delivery/orders/'));
  assert.ok(js.includes('/admin/delivery/flags/'));
  assert.ok(js.includes('Mark resolved'));
});

test('Owner delivery routes are mounted in the authenticated admin API and keep an audit trail', () => {
  const adminData = read('../src/admin-data.js');
  const adminAuth = read('../src/admin-auth.js');
  const delivery = read('../src/delivery-scheduling.js');
  assert.ok(adminData.includes('handleAdminDeliveryRequest'));
  assert.ok(adminData.includes("u.pathname === '/api/admin/delivery'"));
  assert.ok(adminAuth.includes('handleAdminData'));
  assert.ok(delivery.includes('const scheduleMatch'));
  assert.ok(delivery.includes('order_audit_events'));
  assert.ok(delivery.includes('order_operational_flags'));
});

test('store reassignment uses valid reservation SQL and stock-managed products receive per-store inventory rows', () => {
  const delivery = read('../src/delivery-scheduling.js');
  const worker = read('../src/index.js');
  const moveStart = delivery.indexOf('async function moveOrderSchedule');
  const transferSqlAt = delivery.indexOf(
    'INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status,owner_override,override_reason)',
    moveStart
  );
  assert.ok(transferSqlAt >= 0, 'store-transfer reservation insert must exist');
  const transferSql = delivery.slice(transferSqlAt, delivery.indexOf('\n', transferSqlAt));
  assert.ok(transferSql.includes('VALUES (?,?,?,?,?,?,?,?)'),
    'eight inventory reservation columns must have exactly eight placeholders');
  assert.ok(!transferSql.includes('VALUES (?,?,?,?,?,?,?,?,?)'),
    'store reassignment must not send a mismatched nine-placeholder insert');

  assert.ok(delivery.includes('async function ensureStoreInventoryRows(env)'));
  assert.ok(delivery.includes('await ensureStoreInventoryRows(env);'),
    'Owner inventory view and stock updates must repair missing inventory rows safely');
  assert.ok(worker.includes('if(stockManaged){'),
    'creating a stock-managed product must initialise store inventory when stores exist');
  assert.ok(worker.includes('if(Number(current.stock_managed)===0&&payload.stockManaged===true)'),
    'enabling stock management on an existing product must initialise store inventory');
  assert.ok(worker.includes('INSERT OR IGNORE INTO delivery_store_inventory'),
    'product create/update must not duplicate inventory rows');
});

test('customer cancellation uses customer audit identity and rejected reschedules restore the displayed schedule state', () => {
  const delivery = read('../src/delivery-scheduling.js');
  const cancelStart = delivery.indexOf('async function customerAction');
  const cancelEnd = delivery.indexOf('export async function handleCustomerDeliveryRequest', cancelStart);
  const customerActions = delivery.slice(cancelStart, cancelEnd);
  assert.ok(customerActions.includes("actorType: 'customer', actorId: customerId, reason: cancelReason"),
    'customer cancellation must not be attributed to the Owner');
  assert.ok(!customerActions.includes("await writeAudit(env, order.id, 'customer', customerId, 'order_cancelled_by_customer'"),
    'customer cancellation must not create a duplicate audit entry');
  assert.ok(delivery.includes("decision === 'reject' && row.request_type === 'reschedule'"));
  assert.ok(delivery.includes('reschedule_request_rejected_schedule_restored'),
    'rejected reschedule requests must leave My Orders showing the existing schedule');
  assert.ok(delivery.includes("order.delivery_status === 'New' ? 'requested' : 'confirmed'"));
});
