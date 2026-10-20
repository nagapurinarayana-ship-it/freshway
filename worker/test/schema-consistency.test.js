import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0022_test_order_classification.sql', import.meta.url), 'utf8');
const accountPhoneMigration = readFileSync(new URL('../migrations/0023_registered_account_phone.sql', import.meta.url), 'utf8');
const authVersionMigration = readFileSync(new URL('../migrations/0024_customer_auth_version.sql', import.meta.url), 'utf8');

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

const snapshotTable = schema.match(
  /CREATE TABLE IF NOT EXISTS order_address_snapshots \(([\s\S]*?)\n\);/
)?.[1];

test('fresh database address snapshot schema matches the production migration and API insert', () => {
  assert.ok(snapshotTable, 'schema.sql must define the order-address snapshot table');
  for (const column of [
    'customer_id TEXT',
    'address_id INTEGER',
    'recipient_name TEXT NOT NULL',
    'delivery_phone TEXT NOT NULL',
    'house_flat TEXT NOT NULL',
    'delivery_note TEXT',
    'place_name TEXT',
    'place_id TEXT'
  ]) {
    assert.ok(snapshotTable.includes(column), `snapshot schema must include ${column}`);
  }
  assert.match(snapshotTable, /FOREIGN KEY\(address_id\) REFERENCES addresses\(id\) ON DELETE SET NULL/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_customer ON order_address_snapshots\(customer_id,created_at DESC\);/);
  const addressApi = readFileSync(new URL('../src/address-api.js', import.meta.url), 'utf8');
  const insert = addressApi.match(/INSERT OR IGNORE INTO order_address_snapshots \(([^)]+)\)/)?.[1];
  assert.ok(insert, 'address API must keep an explicit snapshot insert column list');
  for (const column of insert.split(',').map(value => value.trim())) {
    assert.ok(snapshotTable.includes(column + ' ') || snapshotTable.includes(column + '\n'), `snapshot API column ${column} must exist in fresh schema`);
  }
});


test('fresh customer schema supports passcode-reset session invalidation', () => {
  const customersTable = schema.split('CREATE TABLE IF NOT EXISTS customers (')[1]?.split('\n);')[0];
  assert.ok(customersTable?.includes('auth_version INTEGER NOT NULL DEFAULT 0'));
  assert.match(authVersionMigration, /ALTER TABLE customers ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0/);
});

test('historical order phone reconciliation preserves delivery contacts in snapshots', () => {
  assert.ok(accountPhoneMigration.includes('UPDATE orders'));
  assert.ok(accountPhoneMigration.includes('SET customer_phone'));
  assert.ok(accountPhoneMigration.includes('c.phone'));
  assert.ok(accountPhoneMigration.includes('orders.customer_id'));
  assert.ok(schema.includes('delivery_phone TEXT NOT NULL'));
});
