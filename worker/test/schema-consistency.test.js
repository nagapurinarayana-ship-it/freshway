import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0022_test_order_classification.sql', import.meta.url), 'utf8');

const ordersTable = schema.match(
  /CREATE TABLE IF NOT EXISTS orders \(([\s\S]*?)\n\);/
)?.[1];

test('fresh database schema includes the test-order classification column', () => {
  assert.ok(ordersTable, 'schema.sql must define the orders table');
  assert.match(
    ordersTable,
    /is_test_order INTEGER NOT NULL DEFAULT 0 CHECK\(is_test_order IN \(0,1\)\)/,
    'new orders must default to live orders and only allow 0/1 classification'
  );
});

test('fresh database schema includes the test-order query index', () => {
  assert.match(
    schema,
    /CREATE INDEX IF NOT EXISTS idx_orders_test_created ON orders\(is_test_order, created_at DESC\);/,
    'fresh databases need the same index as migrated databases'
  );
});

test('legacy database migration stays aligned with the fresh schema', () => {
  assert.match(
    migration,
    /ALTER TABLE orders ADD COLUMN is_test_order INTEGER NOT NULL DEFAULT 0 CHECK\(is_test_order IN \(0,1\)\);/
  );
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS idx_orders_test_created ON orders\(is_test_order, created_at DESC\);/
  );
  assert.equal(
    ordersTable?.includes('is_test_order'),
    true,
    'schema.sql and migration 0022 must both support Owner live/test-order filtering'
  );
});


const savedAddressMigration = readFileSync(new URL('../migrations/0023_separate_saved_addresses.sql', import.meta.url), 'utf8');
const addressesTable = schema.match(/CREATE TABLE IF NOT EXISTS addresses \\(([\\s\\S]*?)\\n\\);/)?.[1];

test('fresh schema separates saved addresses from order-only address rows', () => {
  assert.ok(addressesTable, 'schema.sql must define the addresses table');
  assert.match(addressesTable, /is_saved INTEGER NOT NULL DEFAULT 1 CHECK\\(is_saved IN \\(0,1\\)\\)/);
  assert.match(schema, /idx_addresses_saved_list ON addresses\\(customer_id,is_saved,deleted_at,is_default,id DESC\\)/);
  assert.match(schema, /idx_addresses_one_active_default[\\s\\S]*WHERE is_saved=1 AND deleted_at IS NULL AND is_default=1/);
});

test('upgrade migration keeps historical orders and hides order-only address records from saved lists', () => {
  assert.match(savedAddressMigration, /ALTER TABLE addresses ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 1/);
  assert.match(savedAddressMigration, /UPDATE addresses[\\s\\S]*SET is_saved=0, is_default=0[\\s\\S]*orders.address_id=addresses.id/);
  assert.match(savedAddressMigration, /idx_addresses_one_active_default/);
  assert.match(savedAddressMigration, /NOT EXISTS/);
  assert.doesNotMatch(savedAddressMigration, /DELETE FROM (addresses|orders)/i, 'migration must not delete address/order history');
});
