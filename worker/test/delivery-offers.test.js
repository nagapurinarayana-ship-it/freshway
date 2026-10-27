import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { calculatePriceBreakdown, handleAdminDeliveryOffersRequest } from '../src/delivery-offers.js';
import { groupOrders } from '../src/index.js';

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
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      total INTEGER NOT NULL CHECK(total>=0),
      delivery_status TEXT NOT NULL DEFAULT 'New',
      customer_name TEXT,
      customer_phone TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    const old=db.prepare("SELECT total,items_subtotal,delivery_fee,coupon_discount,coupon_code,pricing_breakdown_known FROM orders WHERE id='order-old-1'").get();
    assert.deepEqual({total:old.total,itemsSubtotal:old.items_subtotal,deliveryFee:old.delivery_fee,discount:old.coupon_discount,code:old.coupon_code,pricingKnown:old.pricing_breakdown_known},
      {total:799,itemsSubtotal:0,deliveryFee:0,discount:0,code:null,pricingKnown:0});
    const columns=db.prepare('PRAGMA table_info(coupons)').all().map(row=>row.name);
    assert.ok(columns.includes('discount_amount'));
    assert.ok(!columns.some(name=>/percentage|percent|minimum|free_delivery/i.test(name)));
    assert.doesNotMatch(migration,/minimum_order|minimum_spend|percentage|percent_discount|free_delivery_coupon/i);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('redemption trigger enforces the recorded order snapshot, fixed discount, and global limit', () => {
  const db=legacyDatabase();
  try {
    db.exec(migration);
    db.prepare("INSERT INTO coupons(id,code,title,discount_amount,starts_on,max_redemptions) VALUES ('coupon-1','SAVE50','Fixed discount',50,'2026-01-01',1)").run();
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known) VALUES ('order-new-1','customer-1',50,100,0,'coupon-1','SAVE50',50,1)").run();
    db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('redemption-1','coupon-1','customer-1','order-new-1','SAVE50',50)").run();
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known) VALUES ('order-new-2','customer-2',50,100,0,'coupon-1','SAVE50',50,1)").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('redemption-2','coupon-1','customer-2','order-new-2','SAVE50',50)").run(), /COUPON_MAX_REDEMPTIONS_REACHED/);

    db.prepare("INSERT INTO coupons(id,code,title,discount_amount,starts_on) VALUES ('coupon-2','WELCOME50','Welcome discount',50,'2026-01-01')").run();
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known) VALUES ('wrong-snapshot-order','customer-2',50,100,0,'coupon-2','WELCOME50',50,1)").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('redemption-3','coupon-2','customer-2','wrong-snapshot-order','WELCOME50',40)").run(), /COUPON_CHANGED/);
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known) VALUES ('small-order','customer-3',0,40,0,'coupon-2','WELCOME50',40,1)").run();
    db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('small-redemption','coupon-2','customer-3','small-order','WELCOME50',40)").run();
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known) VALUES ('wrong-discount-order','customer-1',10,40,10,'coupon-2','WELCOME50',40,1)").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('wrong-discount-redemption','coupon-2','customer-1','wrong-discount-order','WELCOME50',50)").run(), /COUPON_CHANGED/);
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount) VALUES ('unknown-pricing-order','customer-2',50,100,0,'coupon-2','WELCOME50',50)").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('unknown-pricing-redemption','coupon-2','customer-2','unknown-pricing-order','WELCOME50',50)").run(), /COUPON_CHANGED/);
  } finally { db.close(); }
});

test('first-order coupon cannot be reclaimed after cancellation or a later order', () => {
  const db=legacyDatabase();
  try {
    db.exec(migration);
    db.prepare("INSERT INTO coupons(id,code,title,discount_amount,first_order_only,starts_on) VALUES ('first-coupon','FIRST50','First order offer',50,1,'2026-01-01')").run();
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known) VALUES ('first-order','customer-3',50,100,0,'first-coupon','FIRST50',50,1)").run();
    db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount,first_order_only) VALUES ('first-redemption','first-coupon','customer-3','first-order','FIRST50',50,1)").run();
    db.prepare("INSERT INTO first_order_coupon_claims(customer_id,order_id,coupon_id) VALUES ('customer-3','first-order','first-coupon')").run();
    db.prepare("UPDATE orders SET delivery_status='Cancelled' WHERE id='first-order'").run();
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known) VALUES ('second-order','customer-3',50,100,0,'first-coupon','FIRST50',50,1)").run();
    assert.throws(() => db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount,first_order_only) VALUES ('second-redemption','first-coupon','customer-3','second-order','FIRST50',50,1)").run(), /COUPON_FIRST_ORDER_ONLY|COUPON_FIRST_ORDER_USED/);
  } finally { db.close(); }
});


test('idempotent order recovery includes the original pricing snapshot', () => {
  const [order]=groupOrders([{
    id:'FW-RETRY-0001', customer_id:'customer-1', customer_name:'Customer One', customer_phone:'9999999999',
    total:280, items_subtotal:300, delivery_fee:30, coupon_code:'SAVE50', coupon_discount:50,
    pricing_breakdown_known:1, payment_status:'Not Collected', delivery_status:'New', delivery_plan:'Tomorrow',
    created_at:'2026-10-27T10:00:00Z', updated_at:'2026-10-27T10:00:00Z', delivered_at:null,
    payment_collected_at:null, scheduled_delivery_date:null, house:'Test', area:'Area', city:'City', pincode:'500001',
    landmark:'', note:'', product_id:'p1', name:'Rice', unit:'kg', qty:1, price:300, line_total:300
  }]);
  assert.deepEqual({
    total:order.total, itemsSubtotal:order.itemsSubtotal, deliveryFee:order.deliveryFee,
    couponCode:order.couponCode, couponDiscount:order.couponDiscount, pricingBreakdownKnown:order.pricingBreakdownKnown
  }, { total:280, itemsSubtotal:300, deliveryFee:30, couponCode:'SAVE50', couponDiscount:50, pricingBreakdownKnown:true });
});

function d1Adapter(db) {
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) { params = values; return statement; },
        async first() { return db.prepare(sql).get(...params) || null; },
        async all() { return { results: db.prepare(sql).all(...params) }; },
        async run() {
          const result = db.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes || 0), last_row_id: result.lastInsertRowid } };
        }
      };
      return statement;
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

test('Owner redemption history endpoint returns recorded customer and order details', async () => {
  const db=legacyDatabase();
  try {
    db.exec(migration);
    db.prepare("INSERT INTO coupons(id,code,title,discount_amount,starts_on) VALUES ('history-coupon','HISTORY50','History offer',50,'2026-01-01')").run();
    db.prepare("UPDATE customers SET phone='9999999999' WHERE id='customer-1'").run();
    db.prepare("INSERT INTO orders(id,customer_id,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known,customer_name,customer_phone) VALUES ('history-order','customer-1',50,100,0,'history-coupon','HISTORY50',50,1,'Customer One','9999999999')").run();
    db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount) VALUES ('history-redemption','history-coupon','customer-1','history-order','HISTORY50',50)").run();

    const response=await handleAdminDeliveryOffersRequest(
      new Request('https://freshway.example/api/admin/coupons/history-coupon/redemptions'),
      { DB: d1Adapter(db) }
    );
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.limit,100);
    assert.equal(payload.redemptions.length,1);
    assert.deepEqual({
      orderId:payload.redemptions[0].orderId,
      customerName:payload.redemptions[0].customerName,
      customerPhone:payload.redemptions[0].customerPhone,
      discountAmount:payload.redemptions[0].discountAmount,
      orderTotal:payload.redemptions[0].orderTotal,
      status:payload.redemptions[0].status
    },{
      orderId:'history-order',customerName:'Customer One',customerPhone:'9999999999',
      discountAmount:50,orderTotal:50,status:'redeemed'
    });
  } finally { db.close(); }
});

test('Owner coupon UI exposes and requests redemption history', () => {
  const ownerUi=readFileSync(new URL('../../frontend/admin/delivery-offers.js',import.meta.url),'utf8');
  assert.match(ownerUi,/data-fw-coupon-history/);
  assert.match(ownerUi,/\/admin\/coupons\/\'+encodeURIComponent\(couponId\)\+\'\/redemptions/);
});
