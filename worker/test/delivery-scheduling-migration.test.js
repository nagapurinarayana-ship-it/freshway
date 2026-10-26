import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration37 = read('../migrations/0037_order_delivery_scheduling.sql');
const migration38 = read('../migrations/0038_anonymize_delivery_requests.sql');
const migration39 = read('../migrations/0039_customer_preferred_delivery_date.sql');
const migration40 = read('../migrations/0040_order_delivered_at.sql');
const productionSchemaAudit = read('../scripts/audit-production-schema.mjs');

function legacyDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  // Minimal shape of the pre-scheduling production schema: the migration itself
  // must add the new order columns and tables, rather than requiring schema.sql
  // to have already installed them.
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, stock_managed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE orders (id TEXT PRIMARY KEY, delivery_status TEXT NOT NULL DEFAULT 'New');
    INSERT INTO customers (id,name,phone) VALUES ('customer-1','Test Customer','911234567890');
    INSERT INTO customers (id,name,phone) VALUES ('customer-2','Second Customer','919876543210');
    INSERT INTO products (id,name,stock_managed) VALUES ('product-1','Test Product',1);
    INSERT INTO orders (id,delivery_status) VALUES ('order-1','New');
    INSERT INTO orders (id,delivery_status) VALUES ('order-2','New');
  `);
  return db;
}

test('0037 then 0038 migrate a legacy D1-like database without losing requests or breaking foreign keys', () => {
  const db = legacyDatabase();
  try {
    db.exec(migration37);
    const added = db.prepare('PRAGMA table_info(orders)').all().map(column => column.name);
    for (const column of [
      'scheduled_delivery_date','scheduled_slot_id','assigned_store_id',
      'scheduled_start_minute','scheduled_end_minute','schedule_status'
    ]) assert.ok(added.includes(column), '0037 must add orders.' + column);

    assert.equal(db.prepare("SELECT enabled FROM delivery_scheduling_settings WHERE id=1").get().enabled, 0);
    assert.equal(db.prepare("SELECT schedule_status FROM orders WHERE id='order-1'").get().schedule_status, 'unscheduled');

    db.prepare("INSERT INTO delivery_stores (id,name,latitude,longitude,service_radius_km) VALUES ('store-1','Test Store',17.385,78.4867,10)").run();
    db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('store-1','product-1',3)").run();
    db.prepare("INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity) VALUES ('slot-1','store-1','2027-01-15',600,720,1)").run();
    db.prepare("INSERT INTO delivery_slot_reservations (id,order_id,slot_id,status) VALUES ('slot-res-1','order-1','slot-1','reserved')").run();
    assert.throws(
      () => db.prepare("INSERT INTO delivery_slot_reservations (id,order_id,slot_id,status) VALUES ('slot-res-2','order-2','slot-1','reserved')").run(),
      /DELIVERY_SLOT_FULL/
    );

    db.prepare("INSERT INTO order_action_requests (id,order_id,customer_id,request_type,reason,status) VALUES ('request-1','order-1','customer-1','issue','private customer text','pending')").run();
    const oldRequest = db.prepare("SELECT * FROM order_action_requests WHERE id='request-1'").get();
    assert.equal(oldRequest.customer_id, 'customer-1');

    db.exec(migration38);
    db.exec(migration39);
    db.exec(migration40);
    assert.ok(db.prepare('PRAGMA table_info(order_action_requests)').all().some(column => column.name === 'requested_delivery_date'), '0039 must add the customer preferred delivery date');
    assert.ok(db.prepare('PRAGMA table_info(orders)').all().some(column => column.name === 'delivered_at'), '0040 must add the actual delivery timestamp');
    const rebuiltRequest = db.prepare("SELECT * FROM order_action_requests WHERE id='request-1'").get();
    assert.equal(rebuiltRequest.customer_id, 'customer-1');
    assert.equal(rebuiltRequest.reason, 'private customer text');
    assert.equal(rebuiltRequest.status, 'pending');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM delivery_slot_reservations WHERE status='reserved'").get().count, 1);

    // Account deletion can anonymize request metadata while preserving the
    // operational request row for the order's support/audit trail.
    db.prepare("UPDATE order_action_requests SET customer_id=NULL,reason='',resolution_note='' WHERE customer_id='customer-1'").run();
    const anonymized = db.prepare("SELECT * FROM order_action_requests WHERE id='request-1'").get();
    assert.equal(anonymized.customer_id, null);
    assert.equal(anonymized.reason, '');
    assert.equal(anonymized.status, 'pending');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN ('delivery_slot_capacity_before_insert','delivery_slot_capacity_before_update','delivery_store_stock_before_insert','delivery_store_stock_before_update')").get().count, 4);
  } finally {
    db.close();
  }
});

test('0038 rejects an invalid customer id after the request relationship becomes nullable', () => {
  const db = legacyDatabase();
  try {
    db.exec(migration37);
    db.prepare("INSERT INTO order_action_requests (id,order_id,customer_id,request_type) VALUES ('request-1','order-1','customer-1','issue')").run();
    db.exec(migration38);
    assert.throws(
      () => db.prepare("INSERT INTO order_action_requests (id,order_id,customer_id,request_type) VALUES ('request-2','order-2','missing-customer','issue')").run(),
      /FOREIGN KEY constraint failed/
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});


test('Owner date-only endpoint rejects edits to delivered or cancelled orders', () => {
  const delivery = read('../src/delivery-scheduling.js');
  assert.ok(delivery.includes("['delivered', 'cancelled'].includes(String(order.delivery_status || '').trim().toLowerCase())"));
  assert.ok(delivery.includes('Delivery date cannot be changed for a delivered or cancelled order.'));
});

test('production schema audit requires the delivery scheduling schema, migrations, indexes and integrity triggers', () => {
  for (const table of [
    'delivery_scheduling_settings','delivery_stores','delivery_store_inventory','delivery_slots',
    'delivery_slot_reservations','delivery_store_inventory_reservations','order_action_requests',
    'order_audit_events','order_operational_flags'
  ]) assert.match(productionSchemaAudit, new RegExp(table + ': \\['), 'production audit must verify ' + table);
  for (const column of [
    'scheduled_delivery_date','scheduled_slot_id','assigned_store_id','scheduled_start_minute',
    'scheduled_end_minute','schedule_status'
  ]) assert.ok(productionSchemaAudit.includes("'" + column + "'"), 'production audit must verify orders.' + column);
  for (const migration of [
    '0037_order_delivery_scheduling.sql','0038_anonymize_delivery_requests.sql','0039_customer_preferred_delivery_date.sql','0040_order_delivered_at.sql'
  ]) assert.ok(productionSchemaAudit.includes(migration), 'production audit must require ' + migration);
  for (const trigger of [
    'delivery_slot_capacity_before_insert','delivery_slot_capacity_before_update',
    'delivery_store_stock_before_insert','delivery_store_stock_before_update'
  ]) assert.ok(productionSchemaAudit.includes(trigger), 'production audit must require ' + trigger);
});
