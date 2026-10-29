import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0022_test_order_classification.sql', import.meta.url), 'utf8');
const accountPhoneMigration = readFileSync(new URL('../migrations/0023_registered_account_phone.sql', import.meta.url), 'utf8');
const authVersionMigration = readFileSync(new URL('../migrations/0024_customer_auth_version.sql', import.meta.url), 'utf8');
const orderAlertsMigration = readFileSync(new URL('../migrations/0025_order_alerts.sql', import.meta.url), 'utf8');
const storeCoordinatesMigration = readFileSync(new URL('../migrations/0026_store_profile_shop_coordinates.sql', import.meta.url), 'utf8');
const savedAddressMigration = readFileSync(new URL('../migrations/0044_reusable_address_visibility.sql', import.meta.url), 'utf8');

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

test('fresh order schema marks legacy pricing breakdowns unknown by default', () => {
  assert.ok(ordersTable, 'schema.sql must define the orders table');
  assert.match(ordersTable,/pricing_breakdown_known INTEGER NOT NULL DEFAULT 0 CHECK\(pricing_breakdown_known IN \(0,1\)\)/);
  assert.match(schema,/coupon_redemption_guard_before_insert[\s\S]*pricing_breakdown_known=1[\s\S]*coupon_discount=NEW\.discount_amount/);
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


const addressesTable = schema.match(
  /CREATE TABLE IF NOT EXISTS addresses \\(([\\s\\S]*?)\\n\\);/
)?.[1];

test('reusable address visibility separates order-only rows without changing order foreign keys', () => {
  assert.ok(addressesTable, 'schema.sql must define the addresses table');
  assert.match(addressesTable, /is_saved_address INTEGER NOT NULL DEFAULT 1 CHECK\\(is_saved_address IN \\(0,1\\)\\)/);
  assert.match(savedAddressMigration, /ALTER TABLE addresses ADD COLUMN is_saved_address INTEGER NOT NULL DEFAULT 1 CHECK\\(is_saved_address IN \\(0,1\\)\\);/);
  assert.match(savedAddressMigration, /UPDATE addresses SET is_saved_address=0, is_default=0/);
  assert.match(savedAddressMigration, /recipient_name IS NULL OR TRIM\\(recipient_name\\)='' OR delivery_phone IS NULL OR TRIM\\(delivery_phone\\)=''/);
  assert.match(schema, /idx_addresses_customer_saved_default ON addresses\\(customer_id,is_saved_address,is_default DESC,id DESC\\)/);

  const addressApi = readFileSync(new URL('../src/address-api.js', import.meta.url), 'utf8');
  const orderWriter = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(addressApi, /SELECT \\* FROM addresses WHERE customer_id=\\? AND deleted_at IS NULL AND is_saved_address=1/);
  assert.match(addressApi, /is_default,is_saved_address\\) VALUES \\(/);
  assert.match(orderWriter, /INSERT INTO addresses \\([^)]*is_saved_address\\) VALUES \\([^)]*,0\\)/);
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


test('shop map pin columns exist in fresh schema and the additive production migration', () => {
  const profileTable = schema.split('CREATE TABLE IF NOT EXISTS store_profile (')[1]?.split('\n);')[0];
  assert.ok(profileTable, 'schema.sql must define store_profile');
  assert.match(profileTable, /shop_latitude REAL/);
  assert.match(profileTable, /shop_longitude REAL/);
  assert.match(storeCoordinatesMigration, /ALTER TABLE store_profile ADD COLUMN shop_latitude REAL/);
  assert.match(storeCoordinatesMigration, /ALTER TABLE store_profile ADD COLUMN shop_longitude REAL/);
});

test('transactional order alert schema matches the production migration', () => {
  for (const table of ['owner_push_subscriptions', 'notification_events']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`), `fresh schema must define ${table}`);
    assert.match(orderAlertsMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`), `migration 0025 must define ${table}`);
  }
  assert.match(schema, /event_key TEXT NOT NULL UNIQUE/);
  assert.match(orderAlertsMigration, /event_key TEXT NOT NULL UNIQUE/);
  assert.match(schema, /audience TEXT NOT NULL CHECK\(audience IN \(\'customer\',\'owner\'\)\)/);
  assert.match(orderAlertsMigration, /audience TEXT NOT NULL CHECK\(audience IN \(\'customer\',\'owner\'\)\)/);
  assert.match(orderAlertsMigration, /idx_notification_events_audience_id/);
  assert.match(orderAlertsMigration, /idx_notification_events_order_id/);
});

const accountErasureMigration = readFileSync(new URL('../migrations/0034_customer_account_erasure.sql', import.meta.url), 'utf8');
test('customer tombstone support stays aligned between fresh schema and migration', () => {
  const customersTable = schema.split('CREATE TABLE IF NOT EXISTS customers (')[1]?.split('\\n);')[0];
  assert.ok(customersTable?.includes('deleted_at TEXT'));
  assert.match(accountErasureMigration, /ALTER TABLE customers ADD COLUMN deleted_at TEXT/);
  assert.match(accountErasureMigration, /idx_customers_active_phone/);
});


const productionAudit = readFileSync(new URL('../scripts/audit-production-schema.mjs', import.meta.url), 'utf8');
test('production D1 audit covers all Store Profile API fields and deletion/address indexes', () => {
  const profileColumns = productionAudit.match(/store_profile: \[([^\]]+)\]/)?.[1] || '';
  for (const column of [
    'id', 'store_name', 'about', 'phone', 'whatsapp', 'email', 'address',
    'shop_latitude', 'shop_longitude', 'business_hours', 'delivery_info',
    'share_title', 'share_description', 'created_at', 'updated_at'
  ]) {
    assert.ok(profileColumns.includes("'" + column + "'"), 'production schema audit must verify store_profile.' + column);
  }
  for (const index of [
    'idx_customers_active_phone',
    'idx_account_deletion_requests_one_active',
    'idx_account_deletion_requests_status_created',
    'idx_account_deletion_requests_customer_created',
    'idx_addresses_customer_deleted'
  ]) {
    assert.ok(productionAudit.includes("'" + index + "'"), 'production schema audit must verify ' + index);
  }
});
