import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0050_purge_unassigned_legacy_test_orders.sql', import.meta.url), 'utf8');
const expectedIds = [
  'FW-12031400-6NE',
  'FW-53962202-NM5',
  'FW-53402034-XBH',
  'FW-31938520-0L7',
  'FW-87828109-18W',
  'FW-67922479-XYN',
  'FW-08623690-412',
  'FW-57069654-MR4',
  'FW-35019352-MJ4',
  'FW-78689788-FCD',
  'FW-77588644-BHS',
  'FW-70361915-UDE'
];

test('legacy cleanup is restricted to the 12 owner-confirmed test order IDs', () => {
  const targetBlock = migration.match(/INSERT INTO _freshway_legacy_unassigned_test_orders \(id\) VALUES([\s\S]*?);/);
  assert.ok(targetBlock, 'Migration must define a fixed target whitelist');
  const ids = [...targetBlock[1].matchAll(/'((?:FW)-[A-Z0-9-]+)'/g)].map(match => match[1]);
  assert.deepEqual(ids, expectedIds);
  assert.match(migration, /assigned_store_id IS NULL/);
  assert.match(migration, /is_test_order = 0/);
  assert.match(migration, /created_at < '2026-11-03'/);
  assert.match(migration, /delivery_status NOT IN \('Delivered','Cancelled'\)/);
  assert.match(migration, /COUNT\(o\.id\) = 12/);
});

test('legacy aggregate stock reservations are restored before order deletion', () => {
  const stockRestore = migration.indexOf('UPDATE products\nSET stock_quantity = stock_quantity +');
  const reservationDelete = migration.indexOf('DELETE FROM delivery_store_inventory_reservations');
  const parentDelete = migration.indexOf('DELETE FROM orders');
  assert.ok(stockRestore >= 0);
  assert.ok(reservationDelete > stockRestore);
  assert.ok(parentDelete > reservationDelete);
  assert.match(migration, /SUM\(oi\.stock_reserved_qty\)/);
});

test('all order-linked restricted children are deleted before orders', () => {
  const parentDelete = migration.indexOf('DELETE FROM orders');
  for (const table of [
    'notification_events',
    'coupon_redemptions',
    'first_order_coupon_claims',
    'invoice_items',
    'invoices',
    'order_action_requests',
    'delivery_slot_reservations',
    'delivery_store_inventory_reservations',
    'order_audit_events',
    'order_operational_flags'
  ]) {
    const childDelete = migration.indexOf('DELETE FROM ' + table);
    assert.ok(childDelete >= 0 && childDelete < parentDelete, table + ' must be deleted before orders');
  }
  assert.ok(migration.includes('ON DELETE CASCADE rules'));
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM order_items/);
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM order_address_snapshots/);
});

test('cleanup never deletes shared customer, address, product or store master data', () => {
  for (const table of ['customers', 'addresses', 'products', 'delivery_stores', 'delivery_store_inventory']) {
    assert.doesNotMatch(migration, new RegExp('DELETE\\s+FROM\\s+' + table + '\\b', 'i'));
  }
  assert.match(migration, /CREATE TEMP TABLE _freshway_legacy_cleanup_verify/);
  assert.match(migration, /DROP TABLE _freshway_legacy_unassigned_test_orders/);
});
