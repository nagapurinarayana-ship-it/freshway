import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleAdminDeliveryRequest, handleCustomerDeliveryRequest } from '../src/delivery-scheduling.js';

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
      UPDATE delivery_scheduling_settings
        SET enabled=1,booking_horizon_days=7,same_day_cutoff_minutes=120,timezone='Asia/Kolkata'
        WHERE id=1;
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
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('rejecting a customer reschedule restores the exact previously confirmed schedule state', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-reschedule',{date:'2026-01-01',status:'confirmed'});
    const customerResponse=await handleCustomerDeliveryRequest(new Request(
      'https://api.example.test/api/orders/order-reschedule/reschedule',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slotId:'slot-new',reason:'Please move my delivery'})}
    ),{DB:db},'customer-1');
    assert.equal(customerResponse.status,202);
    const customerResult=await customerResponse.json();
    const requestId=customerResult.request.requestId;
    assert.ok(requestId);
    assert.equal(db.db.prepare("SELECT schedule_status FROM orders WHERE id='order-reschedule'").get().schedule_status,'change_requested');

    const ownerResponse=await handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/requests/'+encodeURIComponent(requestId),
      {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'reject',note:'Keep the original confirmed schedule'})}
    ),{DB:db});
    assert.equal(ownerResponse.status,200);
    assert.equal((await ownerResponse.json()).status,'rejected');
    assert.equal(db.db.prepare("SELECT schedule_status FROM orders WHERE id='order-reschedule'").get().schedule_status,'confirmed');
    assert.equal(db.db.prepare("SELECT status FROM order_action_requests WHERE id=?").get(requestId).status,'rejected');
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});
