import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0022_test_order_classification.sql', import.meta.url), 'utf8');
const stockReleaseMigration = readFileSync(new URL('../migrations/0023_order_stock_release_tracking.sql', import.meta.url), 'utf8');

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


test('fresh schema and migration track idempotent cancellation stock releases', () => {
  assert.match(ordersTable || '', /stock_release_token TEXT UNIQUE/);
  assert.match(ordersTable || '', /stock_released_at TEXT/);
  assert.match(stockReleaseMigration, /ALTER TABLE orders ADD COLUMN stock_release_token TEXT;/);
  assert.match(stockReleaseMigration, /ALTER TABLE orders ADD COLUMN stock_released_at TEXT;/);
  assert.match(stockReleaseMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_stock_release_token ON orders\(stock_release_token\) WHERE stock_release_token IS NOT NULL;/);
});
