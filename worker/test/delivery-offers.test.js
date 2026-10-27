import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { calculatePriceBreakdown } from '../src/delivery-offers.js';

const defaults = { freeDeliveryEnabled: true, freeDeliveryThreshold: 800, standardDeliveryFee: 30 };
const migration = readFileSync(new URL('../migrations/0043_delivery_offers_fixed_coupons.sql', import.meta.url), 'utf8');

test('no order minimum: amounts below the threshold remain orderable and pay standard delivery', () => {
  assert.deepEqual(calculatePriceBreakdown(defaults, 100), {
    itemsSubtotal:100, freeDeliveryEnabled:true, freeDeliveryThreshold:800,
    qualifiesForFreeDelivery:false, amountToFreeDelivery:700, standardDeliveryFee:30,
    deliveryFee:30, couponDiscount:0, finalTotal:130
  });
  assert.equal(calculatePriceBreakdown(defaults, 799).finalTotal, 829);
});

test('threshold qualifies at exactly 800 and remains free after a fixed coupon discount', () => {
  const quote = calculatePriceBreakdown(defaults, 800, 50);
  assert.equal(quote.qualifiesForFreeDelivery, true);
  assert.equal(quote.deliveryFee, 0);
  assert.equal(quote.couponDiscount, 50);
  assert.equal(quote.finalTotal, 750);
});

test('fixed discount is capped at items subtotal and cannot make total negative', () => {
  const quote = calculatePriceBreakdown(defaults, 40, 50);
  assert.equal(quote.couponDiscount, 40);
  assert.equal(quote.deliveryFee, 30);
  assert.equal(quote.finalTotal, 30);
});

test('disabled threshold charges configured fee; zero fee makes every order free', () => {
  assert.equal(calculatePriceBreakdown({ ...defaults, freeDeliveryEnabled:false }, 1200).deliveryFee, 30);
  assert.equal(calculatePriceBreakdown({ ...defaults, standardDeliveryFee:0 }, 10).deliveryFee, 0);
});

test('zero threshold makes every order qualify when enabled', () => {
  const quote=calculatePriceBreakdown({ ...defaults, freeDeliveryThreshold:0 }, 1);
  assert.equal(quote.qualifiesForFreeDelivery,true);
  assert.equal(quote.deliveryFee,0);
});

function legacyDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      total INTEGER NOT NULL CHECK(total>=0),
      delivery_status TEXT NOT NULL DEFAULT 'New',
      is_test_order INTEGER NOT NULL DEFAULT 0 CHECK(is_test_order IN (0,1))
    );
    INSERT INTO customers(id,name) VALUES ('customer-1','Customer One'),('customer-2','Customer Two'),('customer-3','Customer Three');
    INSERT INTO orders(id,customer_id,total,is_test_order)
      VALUES ('order-old-1','customer-1',799,0),('order-old-2','customer-2',400,0);
  `);
  return db;
}

test('migration preserves historical totals and installs configurable default delivery settings', () => {
  const db=legacyDatabase();
  try {
    db.exec(migration);
    const settings=db.prepare('SELECT * FROM delivery_offer_settings WHERE id=1').get();
    assert.equal(settings.free_delivery_enabled,1);
    assert.equal(settings.free_delivery_threshold,800);
    assert.equal(settings.standard_delivery_fee,30);
    const old=db.prepare("SELECT total,items_subtotal,delivery_fee,coupon_discount,coupon_code FROM orders WHERE id='order-old-1'").get();
    assert.deepEqual({total:old.total,itemsSubtotal:old.items_subtotal,deliveryFee:old.delivery_fee,discount:old.coupon_discount,code:old.coupon_code},
      {total:799,itemsSubtotal:799,deliveryFee:0,discount:0,code:null});
    const columns=db.prepare('PRAGMA table_info(coupons)').all().map(row=>row.name);
    assert.ok(columns.includes('discount_amount'));
    assert.ok(!columns.some(name=>/percentage|percent|minimum|free_delivery/i.test(name)));
    assert.doesNotMatch(migration,/minimum_order|minimum_spend|percentage|percent_discount|free_delivery_coupon/i);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('redemption trigger prevents global limit bypass and validates fixed discount snapshots', () => {
  const db=legacyDatabase();
  try {
    db.exec(migration);
    db.prepare("INSERT INTO coupons(id,code,title,discount_amount,starts_on,max_redemptions) VALUES ('coupon-1','SAVE50','Fixed discount',50,'2026-01-01',1)").run();
    db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('redemption-1','coupon-1','customer-1','order-old-1','SAVE50',50)").run();
    db.prepare("INSERT INTO orders(id,customer_id,total) VALUES ('order-new-2','customer-2',100)").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('redemption-2','coupon-1','customer-2','order-new-2','SAVE50',50)").run(), /COUPON_MAX_REDEMPTIONS_REACHED/);
    db.prepare("INSERT INTO coupons(id,code,title,discount_amount,starts_on) VALUES ('coupon-2','WELCOME50','Welcome discount',50,'2026-01-01')").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('redemption-3','coupon-2','customer-2','order-new-2','WELCOME50',40)").run(), /COUPON_CHANGED/);
  } finally { db.close(); }
});

test('first-order coupon cannot be reclaimed after cancellation or a later order', () => {
  const db=legacyDatabase();
  try {
    db.exec(migration);
    db.prepare("INSERT INTO coupons(id,code,title,discount_amount,first_order_only,starts_on) VALUES ('first-coupon','FIRST50','First order offer',50,1,'2026-01-01')").run();
    db.prepare("INSERT INTO orders(id,customer_id,total) VALUES ('first-order','customer-3',100)").run();
    db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount,first_order_only) VALUES ('first-redemption','first-coupon','customer-3','first-order','FIRST50',50,1)").run();
    db.prepare("INSERT INTO first_order_coupon_claims(customer_id,order_id,coupon_id) VALUES ('customer-3','first-order','first-coupon')").run();
    db.prepare("UPDATE orders SET delivery_status='Cancelled' WHERE id='first-order'").run();
    db.prepare("INSERT INTO orders(id,customer_id,total) VALUES ('second-order','customer-3',100)").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount,first_order_only) VALUES ('second-redemption','first-coupon','customer-3','second-order','FIRST50',50,1)").run(), /COUPON_FIRST_ORDER_ONLY|COUPON_FIRST_ORDER_USED/);
  } finally { db.close(); }
});

