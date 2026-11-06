import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(new URL('../migrations/0050_purge_unassigned_legacy_test_orders.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
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

function makeDatabase({ assignOneTarget = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  db.prepare("INSERT INTO customers (id,name,phone) VALUES ('cleanup-customer','Legacy test customer','911111111111')").run();
  db.prepare("INSERT INTO addresses (customer_id,house,area,city,pincode) VALUES ('cleanup-customer','1','Test area','Test city','500001')").run();
  db.prepare("INSERT INTO products (id,name,unit,price,stock_managed,stock_quantity) VALUES ('cleanup-product','Test product','each',100,1,4)").run();
  db.prepare("INSERT INTO delivery_stores (id,name,latitude,longitude,service_radius_km,is_active) VALUES ('cleanup-store','Test store',17.385,78.4867,5,1)").run();
  db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('cleanup-store','cleanup-product',10)").run();
  db.prepare("INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active) VALUES ('cleanup-slot','cleanup-store','2026-11-20',600,660,10,1)").run();
  db.prepare("INSERT INTO coupons (id,code,title,discount_amount,starts_on) VALUES ('cleanup-coupon','CLEANUP','Cleanup test coupon',10,'2026-01-01')").run();
  const addressId = Number(db.prepare("SELECT id FROM addresses WHERE customer_id='cleanup-customer'").get().id);

  for (let index = 0; index < expectedIds.length; index++) {
    const id = expectedIds[index];
    const isUrgent = id === 'FW-70361915-UDE';
    db.prepare(`INSERT INTO orders
      (id,customer_id,address_id,customer_name,customer_phone,total,payment_status,delivery_status,delivery_plan,
       assigned_store_id,created_at,is_test_order)
      VALUES (?,?,?,?,?,100,?,?, 'Later',?,?,0)`).run(
        id,'cleanup-customer',addressId,'Legacy test customer','911111111111',
        isUrgent?'Collected':'Not Collected',isUrgent?'Out for Delivery':'New',
        assignOneTarget && index===0 ? 'cleanup-store' : null,
        '2026-11-02 10:00:00'
      );
    db.prepare(`INSERT INTO order_items (order_id,product_id,name,unit,qty,price,line_total,stock_reserved_qty)
      VALUES (?,'cleanup-product','Test product','each',1,100,100,?)`).run(id,index===11?0:1);
    db.prepare("INSERT INTO notification_events (event_key,audience,customer_id,order_id,event_type,title,body) VALUES (?, 'customer','cleanup-customer',?,'test','Test order','Test notification')").run('cleanup-event-'+index,id);
  }

  db.prepare("INSERT INTO order_address_snapshots (order_id,recipient_name,delivery_phone,house_flat,area,city,pincode) VALUES (?,'Test recipient','911111111111','1','Test area','Test city','500001')").run(expectedIds[0]);
  db.prepare("INSERT INTO coupon_redemptions (id,coupon_id,customer_id,order_id,code_snapshot,discount_amount,status) VALUES ('cleanup-redemption','cleanup-coupon','cleanup-customer',?,'CLEANUP',10,'released')").run(expectedIds[0]);
  db.prepare("INSERT INTO first_order_coupon_claims (customer_id,order_id,coupon_id) VALUES ('cleanup-customer',?,'cleanup-coupon')").run(expectedIds[0]);
  db.prepare(`INSERT INTO invoices
    (id,order_id,customer_id,invoice_number,document_type,financial_year,issue_date,seller_snapshot,buyer_snapshot,totals_snapshot)
    VALUES ('cleanup-invoice',?,'cleanup-customer','TEST/001','commercial_invoice','2026-27','2026-11-02','{}','{}','{}')`).run(expectedIds[0]);
  db.prepare(`INSERT INTO invoice_items
    (invoice_id,product_id,name,unit,qty,unit_price_paise,gross_paise,taxable_paise)
    VALUES ('cleanup-invoice','cleanup-product','Test product','each',1,10000,10000,10000)`).run();
  db.prepare("INSERT INTO order_action_requests (id,order_id,customer_id,request_type) VALUES ('cleanup-request',?,'cleanup-customer','issue')").run(expectedIds[0]);
  db.prepare("INSERT INTO delivery_slot_reservations (id,order_id,slot_id,status) VALUES ('cleanup-slot-reservation',?,'cleanup-slot','reserved')").run(expectedIds[0]);
  db.prepare("INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status) VALUES ('cleanup-store-reservation',?,'cleanup-store','cleanup-product',1,'reserved')").run(expectedIds[0]);
  db.prepare("INSERT INTO order_audit_events (id,order_id,actor_type,action) VALUES ('cleanup-audit',?,'system','test_order_created')").run(expectedIds[0]);
  db.prepare("INSERT INTO order_operational_flags (id,order_id,flag_type) VALUES ('cleanup-flag',?,'test_cleanup_fixture')").run(expectedIds[0]);
  return db;
}

test('legacy cleanup is restricted to the 12 owner-confirmed test order IDs and avoids D1 temporary tables', () => {
  assert.doesNotMatch(migration, /CREATE TEMP TABLE/i);
  const targetBlock = migration.match(/INSERT INTO _freshway_legacy_unassigned_test_orders_0050 \(id\) VALUES([\s\S]*?);/);
  assert.ok(targetBlock, 'Migration must define a fixed target whitelist');
  const ids = [...targetBlock[1].matchAll(/'((?:FW)-[A-Z0-9-]+)'/g)].map(match => match[1]);
  assert.deepEqual(ids, expectedIds);
  assert.match(migration, /assigned_store_id IS NULL/);
  assert.match(migration, /is_test_order = 0/);
  assert.match(migration, /created_at < '2026-11-03'/);
  assert.match(migration, /delivery_status NOT IN \('Delivered','Cancelled'\)/);
  assert.match(migration, /COUNT\(o\.id\) = 12/);
});

test('migration hard-deletes the target orders and linked records while preserving shared data', () => {
  const db = makeDatabase();
  try {
    db.exec(migration);
    const count = table => Number(db.prepare('SELECT COUNT(*) count FROM '+table).get().count);
    assert.equal(count('orders'),0);
    for (const table of [
      'order_items','order_address_snapshots','notification_events','coupon_redemptions',
      'first_order_coupon_claims','invoices','invoice_items','order_action_requests',
      'delivery_slot_reservations','delivery_store_inventory_reservations','order_audit_events','order_operational_flags'
    ]) assert.equal(count(table),0,table+' must be empty after cleanup');
    assert.equal(count('customers'),1,'customer account must be preserved');
    assert.equal(count('addresses'),1,'saved address must be preserved');
    assert.equal(count('products'),1,'product master data must be preserved');
    assert.equal(count('delivery_stores'),1,'store master data must be preserved');
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='cleanup-product'").get().stock_quantity),15,
      'legacy unassigned reservations must be restored once before deletion');
  } finally { db.close(); }
});

test('migration fails closed and changes nothing if any whitelisted order has since been assigned', () => {
  const db = makeDatabase({assignOneTarget:true});
  try {
    db.exec('BEGIN');
    assert.throws(() => db.exec(migration), /CHECK constraint failed/);
    db.exec('ROLLBACK');
    assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM orders').get().count),12);
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='cleanup-product'").get().stock_quantity),4);
  } finally { db.close(); }
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
    'notification_events','coupon_redemptions','first_order_coupon_claims','invoice_items',
    'invoices','order_action_requests','delivery_slot_reservations',
    'delivery_store_inventory_reservations','order_audit_events','order_operational_flags'
  ]) {
    const childDelete = migration.indexOf('DELETE FROM ' + table);
    assert.ok(childDelete >= 0 && childDelete < parentDelete, table + ' must be deleted before orders');
  }
  assert.ok(migration.includes('ON DELETE CASCADE rules'));
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM order_items/);
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM order_address_snapshots/);
});

test('cleanup never deletes shared customer, address, product or store master data', () => {
  for (const table of ['customers','addresses','products','delivery_stores','delivery_store_inventory']) {
    assert.doesNotMatch(migration, new RegExp('DELETE\\s+FROM\\s+' + table + '\\b','i'));
  }
  assert.match(migration, /CREATE TABLE _freshway_legacy_cleanup_verify/);
  assert.match(migration, /DROP TABLE _freshway_legacy_unassigned_test_orders_0050/);
});
