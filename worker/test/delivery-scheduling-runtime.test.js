import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleAdminDeliveryRequest, handleCustomerDeliveryRequest } from '../src/delivery-scheduling.js';
import { createOrder } from '../src/index.js';

class SQLiteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    this.db.exec(`
      INSERT INTO customers (id,name,phone) VALUES ('customer-1','Test Customer','911234567890');
      INSERT INTO addresses (customer_id,house,area,city,pincode) VALUES ('customer-1','1-1','Test Area','Test City','500001');
      INSERT INTO products (id,name,unit,price,stock_managed,stock_quantity,low_stock_threshold)
        VALUES ('product-1','Test Rice','kg',100,1,3,1);
      INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active)
        VALUES ('store-1','Test Store','Test Address',17.385,78.4867,10,1);
      INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity)
        VALUES ('store-1','product-1',5);
      INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active)
        VALUES ('slot-old','store-1','2026-01-01',600,720,5,1);
      INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active)
        VALUES ('slot-new','store-1','2026-10-28',600,720,5,1);
    `);
  }
  prepare(sql) {
    const owner=this;
    let args=[];
    const statement={
      bind(...values){args=values;return statement;},
      executeSync(){const result=owner.db.prepare(sql).run(...args);return{meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid||0)}};},
      async run(){return statement.executeSync();},
      async first(){return owner.db.prepare(sql).get(...args)??null;},
      async all(){return{results:owner.db.prepare(sql).all(...args)};}
    };
    return statement;
  }
  async batch(statements){
    this.db.exec('BEGIN');
    try{const results=statements.map(statement=>statement.executeSync());this.db.exec('COMMIT');return results;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  seedOrder(id,{date='2099-01-01',status='confirmed'}={}){
    const address=Number(this.db.prepare("SELECT id FROM addresses WHERE customer_id='customer-1'").get().id);
    this.db.prepare(`INSERT INTO orders
      (id,customer_id,address_id,customer_name,customer_phone,total,payment_status,delivery_status,delivery_plan,
       scheduled_delivery_date,scheduled_slot_id,assigned_store_id,scheduled_start_minute,scheduled_end_minute,schedule_status)
      VALUES (?,?,?,?,?,?,'Not Collected','New','Later',?,'slot-old','store-1',600,720,?)`)
      .run(id,'customer-1',address,'Test Customer','911234567890',200,date,status);
    this.db.prepare(`INSERT INTO order_items (order_id,product_id,name,unit,qty,price,line_total,stock_reserved_qty)
      VALUES (?, 'product-1','Test Rice','kg',2,100,200,2)`).run(id);
    this.db.prepare(`INSERT INTO delivery_slot_reservations (id,order_id,slot_id,status)
      VALUES (?,?, 'slot-old','reserved')`).run('slotres-'+id,id);
    this.db.prepare(`INSERT INTO delivery_store_inventory_reservations
      (id,order_id,store_id,product_id,qty,status) VALUES (?,?, 'store-1','product-1',2,'reserved')`)
      .run('stockres-'+id,id);
  }
  close(){this.db.close();}
}

test('customer cancellation atomically releases stock and slot reservations and attributes the audit to the customer', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-cancel');
    db.db.prepare("INSERT INTO order_action_requests (id,order_id,customer_id,request_type,reason,status) VALUES (?,?,?,?,?,'pending')")
      .run('old-cancel-request','order-cancel','customer-1','cancellation','Legacy queued request');
    const response=await handleCustomerDeliveryRequest(new Request(
      'https://api.example.test/api/orders/order-cancel/cancel',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:'Customer changed their mind'})}
    ),{DB:db},'customer-1');
    assert.equal(response.status,200);
    assert.equal((await response.json()).status,'Cancelled');
    assert.equal(db.db.prepare("SELECT delivery_status FROM orders WHERE id='order-cancel'").get().delivery_status,'Cancelled');
    assert.equal(db.db.prepare("SELECT schedule_status FROM orders WHERE id='order-cancel'").get().schedule_status,'cancelled');
    assert.equal(db.db.prepare("SELECT stock_quantity FROM products WHERE id='product-1'").get().stock_quantity,5);
    assert.equal(db.db.prepare("SELECT stock_reserved_qty FROM order_items WHERE order_id='order-cancel'").get().stock_reserved_qty,0);
    assert.equal(db.db.prepare("SELECT status FROM delivery_slot_reservations WHERE order_id='order-cancel'").get().status,'released');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-cancel'").get().status,'released');
    const audit=db.db.prepare("SELECT actor_type,actor_id,action,reason FROM order_audit_events WHERE order_id='order-cancel' AND action='order_cancelled_by_customer'").get();
    assert.equal(audit.actor_type,'customer');
    assert.equal(audit.actor_id,'customer-1');
    assert.equal(audit.reason,'Customer changed their mind');
    const oldRequest=db.db.prepare("SELECT status,resolution_note,resolved_by FROM order_action_requests WHERE id='old-cancel-request'").get();
    assert.equal(oldRequest.status,'rejected');
    assert.equal(oldRequest.resolved_by,'customer');
    assert.match(oldRequest.resolution_note,/cancelled directly by the customer/i);
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('customer can directly cancel a New order even when its same-day slot is inside the cancellation cutoff', async () => {
  const db=new SQLiteD1();
  try {
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    db.seedOrder('order-cancel-cutoff',{date:today,status:'confirmed'});
    // This date and slot are deliberately inside the old cutoff rule.
    db.db.prepare('UPDATE orders SET scheduled_start_minute=0,scheduled_end_minute=30 WHERE id=?').run('order-cancel-cutoff');
    const response=await handleCustomerDeliveryRequest(new Request(
      'https://api.example.test/api/orders/order-cancel-cutoff/cancel',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:'Customer cancelled before fulfilment'})}
    ),{DB:db},'customer-1');
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.status,'Cancelled');
    assert.equal(db.db.prepare("SELECT delivery_status FROM orders WHERE id='order-cancel-cutoff'").get().delivery_status,'Cancelled');
    assert.equal(db.db.prepare("SELECT COUNT(*) count FROM order_action_requests WHERE order_id='order-cancel-cutoff' AND request_type='cancellation'").get().count,0);
  } finally { db.close(); }
});

test('customer reschedule saves the date, releases the old slot, and preserves store stock reservations', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-reschedule',{date:'2026-01-01',status:'confirmed'});
    const customerResponse=await handleCustomerDeliveryRequest(new Request(
      'https://api.example.test/api/orders/order-reschedule/reschedule',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestedDeliveryDate:'2026-10-28'})}
    ),{DB:db},'customer-1');
    assert.equal(customerResponse.status,200);
    const result=await customerResponse.json();
    assert.equal(result.status,'updated');
    assert.equal(result.scheduledDelivery.date,'2026-10-28');
    assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-reschedule'").get().scheduled_delivery_date,'2026-10-28');
    assert.equal(db.db.prepare("SELECT schedule_status FROM orders WHERE id='order-reschedule'").get().schedule_status,'confirmed');
    assert.equal(db.db.prepare("SELECT scheduled_slot_id FROM orders WHERE id='order-reschedule'").get().scheduled_slot_id,null);
    assert.equal(db.db.prepare("SELECT status FROM delivery_slot_reservations WHERE order_id='order-reschedule'").get().status,'released');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-reschedule'").get().status,'reserved');
    assert.equal(db.db.prepare("SELECT assigned_store_id FROM orders WHERE id='order-reschedule'").get().assigned_store_id,'store-1');
    assert.equal(db.db.prepare("SELECT COUNT(*) count FROM order_action_requests WHERE order_id='order-reschedule' AND request_type='reschedule'").get().count,0);
    const audit=db.db.prepare("SELECT actor_type,actor_id,action FROM order_audit_events WHERE order_id='order-reschedule' AND action='delivery_date_changed_by_customer'").get();
    assert.equal(audit.actor_type,'customer');
    assert.equal(audit.actor_id,'customer-1');
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('legacy generic request cannot queue a delivery-date approval request', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-legacy-reschedule',{date:'2026-10-27',status:'confirmed'});
    const response=await handleCustomerDeliveryRequest(new Request(
      'https://api.example.test/api/orders/order-legacy-reschedule/request',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestType:'reschedule',requestedDeliveryDate:'2026-10-28'})}
    ),{DB:db},'customer-1');
    assert.equal(response.status,409);
    assert.match((await response.json()).error,/Delivery dates update directly/i);
    assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-legacy-reschedule'").get().scheduled_delivery_date,'2026-10-27');
    assert.equal(db.db.prepare("SELECT COUNT(*) count FROM order_action_requests WHERE order_id='order-legacy-reschedule' AND request_type='reschedule'").get().count,0);
  } finally { db.close(); }
});

test('customer reschedule rejects delivered and cancelled orders without changing their dates', async () => {
  for (const status of ['Delivered','Cancelled']) {
    const db=new SQLiteD1();
    try {
      db.seedOrder('order-terminal',{date:'2026-10-27'});
      db.db.prepare('UPDATE orders SET delivery_status=? WHERE id=?').run(status,'order-terminal');
      const response=await handleCustomerDeliveryRequest(new Request(
        'https://api.example.test/api/orders/order-terminal/reschedule',
        {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestedDeliveryDate:'2026-10-28'})}
      ),{DB:db},'customer-1');
      assert.equal(response.status,409);
      assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-terminal'").get().scheduled_delivery_date,'2026-10-27');
      assert.equal(db.db.prepare("SELECT COUNT(*) count FROM order_action_requests WHERE order_id='order-terminal' AND request_type='reschedule'").get().count,0);
    } finally { db.close(); }
  }
});

test('Owner can still save an order delivery date directly without creating slot reservations', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-owner-date',{date:'2026-10-27',status:'confirmed'});
    const ownerResponse=await handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/orders/order-owner-date/schedule',
      {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({deliveryDate:'2026-10-29'})}
    ),{DB:db});
    assert.equal(ownerResponse.status,200);
    assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-owner-date'").get().scheduled_delivery_date,'2026-10-29');
    assert.equal(db.db.prepare("SELECT schedule_status FROM orders WHERE id='order-owner-date'").get().schedule_status,'confirmed');
    assert.equal(db.db.prepare("SELECT scheduled_slot_id FROM orders WHERE id='order-owner-date'").get().scheduled_slot_id,null);
    assert.equal(db.db.prepare("SELECT status FROM delivery_slot_reservations WHERE order_id='order-owner-date'").get().status,'released');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-owner-date'").get().status,'reserved');
    assert.equal(db.db.prepare("SELECT assigned_store_id FROM orders WHERE id='order-owner-date'").get().assigned_store_id,'store-1');
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('checkout creates an order with a server-validated preferred date and reserves global stock exactly once', async () => {
  const db=new SQLiteD1();
  try {
    db.db.prepare(`UPDATE delivery_scheduling_settings
      SET enabled=1,booking_horizon_days=7,same_day_cutoff_minutes=120,timezone='Asia/Kolkata' WHERE id=1`).run();
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    db.db.prepare(`INSERT INTO coupons(id,code,title,discount_amount,first_order_only,starts_on,active)
      VALUES ('coupon-first25','FIRST25','First order fixed coupon',25,1,?,1)`).run(today);
    let deferred;
    const ctx={waitUntil(promise){deferred=promise;}};
    const payload={
      customerId:'customer-1',
      customer:{name:'Test Customer',phone:'1234567890'},
      address:{house:'1-1',area:'Test Area',city:'Test City',pincode:'500001',latitude:17.385,longitude:78.4867},
      items:[{id:'product-1',qty:2}],
      couponCode:'FIRST25',
      expectedTotal:205,
      preferredDeliveryDate:'2026-10-28',
      clientOrderId:'checkout-test-0001'
    };
    const placed=await createOrder({DB:db,APP_ORIGIN:'https://fwcoldpressed.in'},payload,ctx);
    if(deferred)await deferred;
    assert.ok(placed.id);
    assert.equal(placed.total,205);
    assert.equal(placed.itemsSubtotal,200);
    assert.equal(placed.deliveryFee,30);
    assert.equal(placed.couponCode,'FIRST25');
    assert.equal(placed.couponDiscount,25);
    assert.equal(placed.pricingBreakdownKnown,true);
    assert.equal(placed.scheduledDelivery.date,'2026-10-28');
    const order=db.db.prepare('SELECT total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,pricing_breakdown_known,delivery_status,scheduled_delivery_date,scheduled_slot_id,assigned_store_id,schedule_status FROM orders WHERE id=?').get(placed.id);
    assert.equal(order.total,205);
    assert.equal(order.items_subtotal,200);
    assert.equal(order.delivery_fee,30);
    assert.equal(order.coupon_id,'coupon-first25');
    assert.equal(order.coupon_code,'FIRST25');
    assert.equal(order.coupon_discount,25);
    assert.equal(order.pricing_breakdown_known,1);
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM coupon_redemptions WHERE order_id=? AND status=\'redeemed\'').get(placed.id).count,1);
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM first_order_coupon_claims WHERE customer_id=\'customer-1\'').get().count,1);
    assert.equal(order.delivery_status,'New');
    assert.equal(order.scheduled_delivery_date,'2026-10-28');
    assert.equal(order.scheduled_slot_id,null);
    assert.equal(order.assigned_store_id,null);
    assert.equal(order.schedule_status,'requested');
    assert.equal(db.db.prepare(`SELECT stock_quantity FROM products WHERE id='product-1'`).get().stock_quantity,1);
    assert.equal(db.db.prepare('SELECT stock_reserved_qty FROM order_items WHERE order_id=?').get(placed.id).stock_reserved_qty,2);
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM delivery_store_inventory_reservations WHERE order_id=?').get(placed.id).count,0);
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM delivery_slot_reservations WHERE order_id=?').get(placed.id).count,0);
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);

    const retried=await createOrder({DB:db,APP_ORIGIN:'https://fwcoldpressed.in'},payload,{waitUntil(promise){deferred=promise;}});
    assert.equal(retried.id,placed.id,'idempotent checkout retry must return the original order');
    assert.equal(retried.total,205);
    assert.equal(retried.pricingBreakdownKnown,true);
    assert.equal(retried.itemsSubtotal,200);
    assert.equal(retried.deliveryFee,30);
    assert.equal(retried.couponCode,'FIRST25');
    assert.equal(retried.couponDiscount,25);
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM coupon_redemptions WHERE order_id=?').get(placed.id).count,1,'retry must not create another redemption');
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM first_order_coupon_claims WHERE customer_id=\'customer-1\'').get().count,1,'retry must not create another first-order claim');
    assert.equal(db.db.prepare(`SELECT stock_quantity FROM products WHERE id='product-1'`).get().stock_quantity,1,'retry must not reserve global stock twice');
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM delivery_slot_reservations WHERE order_id=?').get(placed.id).count,0);
  } finally { db.close(); }
});
