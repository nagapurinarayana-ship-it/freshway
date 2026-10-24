import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0037_serviceable_areas.sql', import.meta.url), 'utf8');
const serviceability = readFileSync(new URL('../src/serviceability.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/admin-data.js', import.meta.url), 'utf8');
const tables = ['serviceability_settings','delivery_zones','serviceability_audit','order_serviceability_snapshots'];

test('serviceable-area tables exist in both fresh schema and additive migration', () => {
  for (const table of tables) {
    assert.match(schema, new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\s*\\('), 'fresh schema missing ' + table);
    assert.match(migration, new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\s*\\('), 'migration missing ' + table);
  }
  assert.match(migration, /INSERT OR IGNORE INTO serviceability_settings \\(id,enforcement_mode,config_version\\) VALUES \\(1,'off',1\\)/);
  assert.match(schema, /enforcement_mode TEXT NOT NULL DEFAULT 'off'/);
});

test('migration is additive and preserves all pre-existing orders and customer data', () => {
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM (orders|customers|addresses)|UPDATE (orders|customers|addresses)/i);
  assert.match(migration, /FOREIGN KEY\(order_id\) REFERENCES orders\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /FOREIGN KEY\(zone_id\).*delivery_zones/i);
});

test('serviceability is checked before writes and its snapshot shares the order batch', () => {
  const start = worker.indexOf('async function createOrder(');
  const end = worker.indexOf('async function customerOrders(', start);
  const createOrder = worker.slice(start, end);
  assert.match(createOrder, /const serviceabilitySnapshot = env\.DB\.prepare\('INSERT INTO order_serviceability_snapshots/);
  assert.match(createOrder, /const statements=\[\.\.\.stockUpdates,[\s\S]*?serviceabilitySnapshot\]/);
  assert.ok(createOrder.indexOf('checkServiceability(env, address)') < createOrder.indexOf('INSERT INTO customers'));
  assert.ok(createOrder.indexOf('checkServiceability(env, address)') < createOrder.indexOf('INSERT INTO addresses'));
  assert.ok(createOrder.indexOf('checkServiceability(env, address)') < createOrder.indexOf('const { items, total } = await validateOrderItems(env, rawItems)'));
});

test('Owner routes cover listing, zone create/update, testing and enforcement changes', () => {
  assert.match(admin, /\/api\/admin\/serviceability/);
  assert.match(admin, /createServiceabilityZone/);
  assert.match(admin, /updateServiceabilityZone/);
  assert.match(admin, /updateServiceabilitySettings/);
  assert.match(admin, /testServiceabilityDestination/);
});

test('public decision endpoint returns only customer-safe fields', () => {
  assert.match(worker, /\/api\/serviceability\/check/);
  assert.match(worker, /customerLabel:decision\.zone\?\.customerLabel/);
  const route = worker.slice(worker.indexOf("if(url.pathname==='/api/serviceability/check'"), worker.indexOf("if(url.pathname==='/api/products'"));
  assert.doesNotMatch(route, /internalNote|polygon|pinCodes/);
});

test('PIN validation rejects truncation of invalid values', () => {
  assert.match(serviceability, /const pincode = String\(rawPin \?\? ''\)\.trim\(\)/);
  assert.match(serviceability, /const pin = String\(entry \?\? ''\)\.trim\(\)/);
});
