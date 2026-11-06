import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleAdminDeliveryRequest, handleCustomerDeliveryRequest } from '../src/delivery-scheduling.js';
import { updateOrder } from '../src/admin-orders.js';
import { createOrder } from '../src/index.js';

function dateInIndia(daysFromToday = 0) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + daysFromToday)).toISOString().slice(0, 10);
}

class SQLiteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    this.db.exec(`
      INSERT INTO customers (id,name,phone) VALUES ('customer-1','Test Customer','911234567890');
      INSERT INTO addresses (customer_id,house,area,city,pincode,latitude,longitude) VALUES ('customer-1','1-1','Test Area','Test City','500001',17.385,78.4867);
      INSERT INTO products (id,name,unit,price,category_id,stock_managed,stock_quantity,low_stock_threshold)
        VALUES ('product-1','Test Rice','kg',100,'cat-rice',1,3,1);
      INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active)
        VALUES ('store-1','Test Store','Test Address',17.385,78.4867,10,1);
      INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity)
        VALUES ('store-1','product-1',5);
      INSERT INTO delivery_store_catalogue (store_id,product_id,is_available,price_override) VALUES ('store-1','product-1',1,NULL);
      INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active)
        VALUES ('slot-old','store-1','2026-01-01',600,720,5,1);
      INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active)
        VALUES ('slot-new','store-1','${dateInIndia(1)}',600,720,5,1);
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

test('new Owner stores start inactive with zero stock when another store already exists', async () => {
  const db=new SQLiteD1();
  try {
    const response=await handleAdminDeliveryRequest(new Request('https://api.example.test/api/admin/delivery/stores',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name:'New Test Store',address:'Second Address',latitude:17.39,longitude:78.49})
    }),{DB:db});
    assert.equal(response.status,201);
    const result=await response.json();
    assert.equal(result.store.is_active,0);
    assert.equal(result.store.service_radius_km,5);
    assert.equal(result.initialInventory,'zero-stock-requires-setup');
    assert.equal(db.db.prepare('SELECT is_active FROM delivery_stores WHERE id=?').get(result.store.id).is_active,0);
    assert.equal(db.db.prepare("SELECT stock_quantity FROM delivery_store_inventory WHERE store_id=? AND product_id='product-1'").get(result.store.id).stock_quantity,0);
    assert.equal(db.db.prepare("SELECT stock_quantity FROM products WHERE id='product-1'").get().stock_quantity,5,
      'only the existing active store contributes to the customer-facing aggregate');
  } finally { db.close(); }
});

test('customer availability requires a map pin, respects active-store radius and reports clear states', async () => {
  const db=new SQLiteD1();
  try {
    const check=async body=>{
      const response=await handleCustomerDeliveryRequest(new Request('https://api.example.test/api/delivery/availability',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
      }),{DB:db},'');
      assert.equal(response.status,200);
      return response.json();
    };
    const basket={items:[{id:'product-1',qty:2}]};
    const available=await check({...basket,address:{latitude:17.385,longitude:78.4867}});
    assert.equal(available.available,true);
    assert.equal(available.store.id,'store-1');
    assert.equal(available.code,'AVAILABLE');

    const missingPin=await check({...basket,address:{city:'Test City',pincode:'500001'}});
    assert.equal(missingPin.available,false);
    assert.equal(missingPin.code,'LOCATION_REQUIRED');
    const partialPin=await check({...basket,address:{latitude:null,longitude:78.4867}});
    assert.equal(partialPin.available,false);
    assert.equal(partialPin.code,'LOCATION_REQUIRED');

    const outside=await check({...basket,address:{latitude:18.5,longitude:79.5}});
    assert.equal(outside.available,false);
    assert.equal(outside.code,'AREA_UNAVAILABLE');

    db.db.prepare("UPDATE delivery_stores SET is_active=0 WHERE id='store-1'").run();
    const inactive=await check({...basket,address:{latitude:17.385,longitude:78.4867}});
    assert.equal(inactive.available,false);
    assert.equal(inactive.code,'NO_ACTIVE_STORE');
  } finally { db.close(); }
});

test('availability falls back to the next-nearest store that can fulfil the entire basket without splitting it', async () => {
  const db=new SQLiteD1();
  try {
    db.db.prepare("INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active) VALUES ('store-near','A Nearby Store','Near',17.385,78.4867,5,1)").run();
    db.db.prepare("INSERT INTO delivery_store_catalogue (store_id,product_id,is_available,price_override) VALUES ('store-near','product-1',1,NULL)").run();
    db.db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('store-near','product-1',0)").run();
    let response=await handleCustomerDeliveryRequest(new Request('https://api.example.test/api/delivery/availability',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:{latitude:17.385,longitude:78.4867},items:[{id:'product-1',qty:2}]})
    }),{DB:db},'');
    let result=await response.json();
    assert.equal(result.available,true);
    assert.equal(result.store.id,'store-1','nearest store without enough stock must be skipped');

    db.db.prepare("INSERT INTO products (id,name,unit,price,category_id,stock_managed,stock_quantity,low_stock_threshold) VALUES ('product-2','Test Oil','litre',150,'cat-oils',1,5,1)").run();
    db.db.prepare("INSERT OR IGNORE INTO delivery_store_catalogue (store_id,product_id,is_available,price_override) SELECT s.id,'product-2',1,NULL FROM delivery_stores s").run();
    db.db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('store-near','product-2',5)").run();
    await db.prepare("INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) SELECT s.id,p.id,0 FROM delivery_stores s CROSS JOIN products p WHERE p.stock_managed=1").run();
    response=await handleCustomerDeliveryRequest(new Request('https://api.example.test/api/delivery/availability',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:{latitude:17.385,longitude:78.4867},items:[{id:'product-1',qty:2},{id:'product-2',qty:1}]})
    }),{DB:db},'');
    result=await response.json();
    assert.equal(result.available,false,'the system must not split a basket across two stores');
    assert.equal(result.code,'OUT_OF_STOCK');
  } finally { db.close(); }
});

test('Owner can reassign a pending order only to an active store with enough stock for the full basket', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-reassign');
    db.db.prepare("UPDATE order_items SET stock_reserved_qty=0 WHERE order_id='order-reassign'").run();
    db.db.prepare("INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active) VALUES ('store-2','Second Store','Second Address',17.39,78.49,5,1)").run();
    db.db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('store-2','product-1',1)").run();
    const assign=()=>handleAdminDeliveryRequest(new Request('https://api.example.test/api/admin/delivery/orders/order-reassign/store',{
      method:'PATCH',headers:{'content-type':'application/json','X-Freshway-Owner-Id':'owner-test'},
      body:JSON.stringify({storeId:'store-2',reason:'Move to a store with stock'})
    }),{DB:db});
    await assert.rejects(assign,/cannot fulfil the complete order/i);
    assert.equal(db.db.prepare("SELECT assigned_store_id FROM orders WHERE id='order-reassign'").get().assigned_store_id,'store-1');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-reassign'").get().status,'reserved');

    db.db.prepare("UPDATE delivery_store_inventory SET stock_quantity=5 WHERE store_id='store-2' AND product_id='product-1'").run();
    const response=await assign();
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.store.id,'store-2');
    const order=db.db.prepare("SELECT assigned_store_id,scheduled_delivery_date,scheduled_slot_id FROM orders WHERE id='order-reassign'").get();
    assert.equal(order.assigned_store_id,'store-2');
    assert.equal(order.scheduled_delivery_date,'2099-01-01','reassignment must preserve the requested date');
    assert.equal(order.scheduled_slot_id,null,'a store-specific slot must be cleared on reassignment');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-reassign' AND store_id='store-1'").get().status,'released');
    assert.equal(db.db.prepare("SELECT status,qty FROM delivery_store_inventory_reservations WHERE order_id='order-reassign' AND store_id='store-2'").get().status,'reserved');
    assert.equal(db.db.prepare("SELECT stock_reserved_qty FROM order_items WHERE order_id='order-reassign'").get().stock_reserved_qty,2,'store reassignment must restore the order stock reservation ledger');
    assert.equal(db.db.prepare("SELECT status FROM delivery_slot_reservations WHERE order_id='order-reassign'").get().status,'released');
    assert.equal(db.db.prepare("SELECT stock_quantity FROM products WHERE id='product-1'").get().stock_quantity,8);
  } finally { db.close(); }
});

test('Owner slot reassignment checks store radius and keeps store stock reservations linked to order items', async () => {
  const db=new SQLiteD1();
  const date=dateInIndia(1);
  try {
    db.seedOrder('order-slot-store');
    db.db.prepare("INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active) VALUES ('store-near','Nearby Store','Nearby Address',17.39,78.49,5,1)").run();
    db.db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('store-near','product-1',5)").run();
    db.db.prepare("INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active) VALUES ('slot-near','store-near',?,600,720,5,1)").run(date);

    const assign=slotId=>handleAdminDeliveryRequest(new Request('https://api.example.test/api/admin/delivery/orders/order-slot-store/schedule',{
      method:'PATCH',headers:{'content-type':'application/json','X-Freshway-Owner-Id':'owner-test'},
      body:JSON.stringify({slotId})
    }),{DB:db});
    const response=await assign('slot-near');
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.scheduledDelivery.storeId,'store-near');
    assert.equal(db.db.prepare("SELECT assigned_store_id FROM orders WHERE id='order-slot-store'").get().assigned_store_id,'store-near');
    assert.equal(db.db.prepare("SELECT stock_reserved_qty FROM order_items WHERE order_id='order-slot-store'").get().stock_reserved_qty,2);
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-slot-store' AND store_id='store-1'").get().status,'released');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-slot-store' AND store_id='store-near'").get().status,'reserved');

    db.db.prepare("INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active) VALUES ('store-far','Far Store','Far Address',18.5,79.5,1,1)").run();
    db.db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('store-far','product-1',5)").run();
    db.db.prepare("INSERT INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active) VALUES ('slot-far','store-far',?,600,720,5,1)").run(date);
    await assert.rejects(assign('slot-far'),/does not cover the customer delivery location/i);
    assert.equal(db.db.prepare("SELECT assigned_store_id FROM orders WHERE id='order-slot-store'").get().assigned_store_id,'store-near');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-slot-store' AND store_id='store-near'").get().status,'reserved');
  } finally { db.close(); }
});

test('reopening checks the assigned store and Owner can reconfirm that store after stock is replenished', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-reopen-stock');
    db.db.prepare("INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active) VALUES ('store-2','Other Active Store','Other Address',17.39,78.49,5,1)").run();
    db.db.prepare("INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) VALUES ('store-2','product-1',10)").run();

    await updateOrder({DB:db},'order-reopen-stock',{status:'Cancelled'});
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-reopen-stock' ORDER BY created_at DESC LIMIT 1").get().status,'released');

    db.seedOrder('order-other-stock');
    db.db.prepare("UPDATE delivery_store_inventory_reservations SET qty=4 WHERE order_id='order-other-stock' AND store_id='store-1' AND product_id='product-1'").run();
    db.db.prepare("UPDATE products SET stock_quantity=11 WHERE id='product-1'").run();

    const reopened=await updateOrder({DB:db},'order-reopen-stock',{status:'New'});
    assert.match(reopened.inventoryWarning,/inventory shortfall/i);
    const shortage=JSON.parse(db.db.prepare("SELECT details_json FROM order_operational_flags WHERE order_id='order-reopen-stock' AND flag_type='reopen_stock_shortfall' AND status='open'").get().details_json);
    assert.equal(shortage.products[0].available,1,'availability must come from the assigned store, not another active store');
    assert.equal(shortage.products[0].required,2);
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-reopen-stock' AND status='conflict'").get().status,'conflict');

    db.db.prepare("UPDATE delivery_store_inventory SET stock_quantity=8 WHERE store_id='store-1' AND product_id='product-1'").run();
    const response=await handleAdminDeliveryRequest(new Request('https://api.example.test/api/admin/delivery/orders/order-reopen-stock/store',{
      method:'PATCH',headers:{'content-type':'application/json','X-Freshway-Owner-Id':'owner-test'},
      body:JSON.stringify({storeId:'store-1',reason:'Recheck inventory after replenishment'})
    }),{DB:db});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.reconfirmed,true);
    assert.equal(db.db.prepare("SELECT status,owner_override FROM delivery_store_inventory_reservations WHERE order_id='order-reopen-stock' AND status='reserved' ORDER BY created_at DESC LIMIT 1").get().status,'reserved');
    assert.equal(db.db.prepare("SELECT stock_reserved_qty FROM order_items WHERE order_id='order-reopen-stock'").get().stock_reserved_qty,2);
    assert.equal(db.db.prepare("SELECT status FROM order_operational_flags WHERE order_id='order-reopen-stock' AND flag_type='reopen_stock_shortfall'").get().status,'resolved');
  } finally { db.close(); }
});

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
  const requestedDate=dateInIndia(1);
  try {
    db.seedOrder('order-reschedule',{date:'2026-01-01',status:'confirmed'});
    const customerResponse=await handleCustomerDeliveryRequest(new Request(
      'https://api.example.test/api/orders/order-reschedule/reschedule',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestedDeliveryDate:requestedDate})}
    ),{DB:db},'customer-1');
    assert.equal(customerResponse.status,200);
    const result=await customerResponse.json();
    assert.equal(result.status,'updated');
    assert.equal(result.scheduledDelivery.date,requestedDate);
    assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-reschedule'").get().scheduled_delivery_date,requestedDate);
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
  const requestedDate=dateInIndia(1);
  try {
    db.seedOrder('order-legacy-reschedule',{date:'2026-10-27',status:'confirmed'});
    const response=await handleCustomerDeliveryRequest(new Request(
      'https://api.example.test/api/orders/order-legacy-reschedule/request',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestType:'reschedule',requestedDeliveryDate:requestedDate})}
    ),{DB:db},'customer-1');
    assert.equal(response.status,409);
    assert.match((await response.json()).error,/Delivery dates update directly/i);
    assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-legacy-reschedule'").get().scheduled_delivery_date,'2026-10-27');
    assert.equal(db.db.prepare("SELECT COUNT(*) count FROM order_action_requests WHERE order_id='order-legacy-reschedule' AND request_type='reschedule'").get().count,0);
  } finally { db.close(); }
});

test('customer reschedule rejects delivered and cancelled orders without changing their dates', async () => {
  const requestedDate=dateInIndia(1);
  for (const status of ['Delivered','Cancelled']) {
    const db=new SQLiteD1();
    try {
      db.seedOrder('order-terminal',{date:'2026-10-27'});
      db.db.prepare('UPDATE orders SET delivery_status=? WHERE id=?').run(status,'order-terminal');
      const response=await handleCustomerDeliveryRequest(new Request(
        'https://api.example.test/api/orders/order-terminal/reschedule',
        {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestedDeliveryDate:requestedDate})}
      ),{DB:db},'customer-1');
      assert.equal(response.status,409);
      assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-terminal'").get().scheduled_delivery_date,'2026-10-27');
      assert.equal(db.db.prepare("SELECT COUNT(*) count FROM order_action_requests WHERE order_id='order-terminal' AND request_type='reschedule'").get().count,0);
    } finally { db.close(); }
  }
});

test('Owner can still save an order delivery date directly without creating slot reservations', async () => {
  const db=new SQLiteD1();
  const requestedDate=dateInIndia(1);
  try {
    db.seedOrder('order-owner-date',{date:'2026-10-27',status:'confirmed'});
    const ownerResponse=await handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/orders/order-owner-date/schedule',
      {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({deliveryDate:requestedDate})}
    ),{DB:db});
    assert.equal(ownerResponse.status,200);
    assert.equal(db.db.prepare("SELECT scheduled_delivery_date FROM orders WHERE id='order-owner-date'").get().scheduled_delivery_date,requestedDate);
    assert.equal(db.db.prepare("SELECT schedule_status FROM orders WHERE id='order-owner-date'").get().schedule_status,'confirmed');
    assert.equal(db.db.prepare("SELECT scheduled_slot_id FROM orders WHERE id='order-owner-date'").get().scheduled_slot_id,null);
    assert.equal(db.db.prepare("SELECT status FROM delivery_slot_reservations WHERE order_id='order-owner-date'").get().status,'released');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-owner-date'").get().status,'reserved');
    assert.equal(db.db.prepare("SELECT assigned_store_id FROM orders WHERE id='order-owner-date'").get().assigned_store_id,'store-1');
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('checkout creates an order with a server-validated preferred date and reserves selected store stock exactly once', async () => {
  const db=new SQLiteD1();
  const requestedDate=dateInIndia(1);
  try {
    db.db.prepare(`UPDATE delivery_scheduling_settings
      SET enabled=1,booking_horizon_days=7,same_day_cutoff_minutes=120,timezone='Asia/Kolkata' WHERE id=1`).run();
    db.db.prepare("UPDATE products SET stock_quantity=5 WHERE id='product-1'").run();
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
      preferredDeliveryDate:requestedDate,
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
    assert.equal(placed.scheduledDelivery.date,requestedDate);
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
    assert.equal(order.scheduled_delivery_date,requestedDate);
    assert.equal(order.scheduled_slot_id,null);
    assert.equal(order.assigned_store_id,'store-1');
    assert.equal(order.schedule_status,'requested');
    assert.equal(db.db.prepare(`SELECT stock_quantity FROM products WHERE id='product-1'`).get().stock_quantity,3);
    assert.equal(db.db.prepare('SELECT stock_reserved_qty FROM order_items WHERE order_id=?').get(placed.id).stock_reserved_qty,2);
    assert.equal(db.db.prepare("SELECT COUNT(*) count FROM delivery_store_inventory_reservations WHERE order_id=? AND status='reserved'").get(placed.id).count,1);
    assert.equal(db.db.prepare('SELECT qty FROM delivery_store_inventory_reservations WHERE order_id=?').get(placed.id).qty,2);
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
    assert.equal(db.db.prepare(`SELECT stock_quantity FROM products WHERE id='product-1'`).get().stock_quantity,3,'retry must not reserve store stock twice');
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM delivery_store_inventory_reservations WHERE order_id=?').get(placed.id).count,1,'retry must not create duplicate store reservations');
    assert.equal(db.db.prepare('SELECT COUNT(*) count FROM delivery_slot_reservations WHERE order_id=?').get(placed.id).count,0);
  } finally { db.close(); }
});


test('Owner reconciliation queue suggests only in-radius stores that can fulfil the whole basket', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-review-candidate');
    db.db.prepare("UPDATE orders SET assigned_store_id=NULL,scheduled_delivery_date=? WHERE id='order-review-candidate'")
      .run(dateInIndia(-2));
    const response=await handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/reconciliation'
    ),{DB:db});
    assert.equal(response.status,200);
    const result=await response.json();
    const review=result.orders.find(order=>order.orderId==='order-review-candidate');
    assert.ok(review);
    assert.equal(review.locationAvailable,true);
    assert.equal(review.scheduledDateExpired,true);
    assert.equal(review.diagnosis,'eligible-store-found-date-needs-confirmation');
    assert.deepEqual(review.eligibleStores.map(store=>store.id),['store-1']);
    assert.equal(review.eligibleStores[0].canFulfilWholeBasket,true);
    assert.equal(review.items[0].name,'Test Rice');
    assert.equal(review.items[0].quantity,2);
    assert.equal(review.urgentDeliveryVerification,false);
    assert.equal(db.db.prepare("SELECT assigned_store_id FROM orders WHERE id='order-review-candidate'").get().assigned_store_id,null,
      'loading the reconciliation queue must not change an order');
    assert.equal(db.db.prepare("SELECT status FROM delivery_store_inventory_reservations WHERE order_id='order-review-candidate'").get().status,'reserved');
  } finally { db.close(); }
});

test('Owner reconciliation requires explicit customer confirmation, a future date and a meaningful audit note', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-reconcile-guard');
    db.db.prepare("UPDATE orders SET assigned_store_id=NULL,scheduled_delivery_date=? WHERE id='order-reconcile-guard'")
      .run(dateInIndia(-1));
    const request=body=>handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/orders/order-reconcile-guard/reconcile',
      {method:'PATCH',headers:{'content-type':'application/json','X-Freshway-Owner-Id':'owner-test'},body:JSON.stringify(body)}
    ),{DB:db});
    await assert.rejects(request({
      customerConfirmed:false,storeId:'store-1',deliveryDate:dateInIndia(1),
      confirmationNote:'Customer confirmed the change.'
    }),/reconfirmed the delivery location/i);
    await assert.rejects(request({
      customerConfirmed:true,storeId:'store-1',deliveryDate:dateInIndia(-1),
      confirmationNote:'Customer confirmed the change.'
    }),/between today and the next 60 days/i);
    await assert.rejects(request({
      customerConfirmed:true,storeId:'store-1',deliveryDate:dateInIndia(1),
      confirmationNote:'short'
    }),/meaningful customer-confirmation note/i);

    const order=db.db.prepare("SELECT assigned_store_id,scheduled_delivery_date FROM orders WHERE id='order-reconcile-guard'").get();
    assert.equal(order.assigned_store_id,null);
    assert.equal(order.scheduled_delivery_date,dateInIndia(-1));
    assert.equal(db.db.prepare("SELECT COUNT(*) count FROM order_audit_events WHERE order_id='order-reconcile-guard'").get().count,0);
  } finally { db.close(); }
});

test('Owner reconciliation atomically assigns the eligible store, moves reservations and records customer confirmation', async () => {
  const db=new SQLiteD1();
  const tomorrow=dateInIndia(1);
  try {
    db.seedOrder('order-reconcile-success');
    db.db.prepare("UPDATE orders SET assigned_store_id=NULL,scheduled_delivery_date=? WHERE id='order-reconcile-success'")
      .run(dateInIndia(-3));
    const response=await handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/orders/order-reconcile-success/reconcile',
      {method:'PATCH',headers:{'content-type':'application/json','X-Freshway-Owner-Id':'owner-test'},
        body:JSON.stringify({
          customerConfirmed:true,storeId:'store-1',deliveryDate:tomorrow,
          confirmationNote:'Customer reconfirmed the delivery location and tomorrow date by phone.'
        })}
    ),{DB:db});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.ok,true);
    assert.equal(result.store.id,'store-1');
    assert.equal(result.scheduledDelivery.date,tomorrow);
    const order=db.db.prepare("SELECT assigned_store_id,scheduled_delivery_date,scheduled_slot_id,schedule_status,delivery_plan FROM orders WHERE id='order-reconcile-success'").get();
    assert.equal(order.assigned_store_id,'store-1');
    assert.equal(order.scheduled_delivery_date,tomorrow);
    assert.equal(order.scheduled_slot_id,null);
    assert.equal(order.schedule_status,'confirmed');
    assert.equal(order.delivery_plan,tomorrow===dateInIndia(1)?'Tomorrow':'Later');
    const reservations=db.db.prepare("SELECT status,qty FROM delivery_store_inventory_reservations WHERE order_id='order-reconcile-success' AND store_id='store-1'").all();
    const activeReservations=reservations.filter(row=>row.status==='reserved');
    const releasedReservations=reservations.filter(row=>row.status==='released');
    assert.equal(activeReservations.length,1);
    assert.equal(activeReservations[0].qty,2);
    assert.equal(releasedReservations.length,1);
    assert.equal(db.db.prepare("SELECT stock_reserved_qty FROM order_items WHERE order_id='order-reconcile-success'").get().stock_reserved_qty,2);
    assert.equal(db.db.prepare("SELECT status FROM delivery_slot_reservations WHERE order_id='order-reconcile-success'").get().status,'released');
    const audit=db.db.prepare("SELECT actor_type,action,reason,after_json FROM order_audit_events WHERE order_id='order-reconcile-success' ORDER BY created_at DESC,id DESC LIMIT 1").get();
    assert.equal(audit.actor_type,'owner');
    assert.equal(audit.action,'unassigned_order_reconciled');
    assert.match(audit.reason,/reconfirmed/);
    assert.equal(JSON.parse(audit.after_json).customerConfirmed,true);
    assert.equal(db.db.prepare("SELECT payment_status FROM orders WHERE id='order-reconcile-success'").get().payment_status,'Not Collected',
      'reconciliation must never alter payment state');
    assert.equal(db.db.prepare("SELECT delivery_status FROM orders WHERE id='order-reconcile-success'").get().delivery_status,'New',
      'reconciliation must never silently advance order status');
  } finally { db.close(); }
});

test('Owner reconciliation blocks paid Out for Delivery orders until receipt is verified', async () => {
  const db=new SQLiteD1();
  try {
    db.seedOrder('order-reconcile-urgent');
    db.db.prepare("UPDATE orders SET assigned_store_id=NULL,delivery_status='Out for Delivery',payment_status='Collected' WHERE id='order-reconcile-urgent'").run();
    const queueResponse=await handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/reconciliation'
    ),{DB:db});
    const queue=await queueResponse.json();
    const item=queue.orders.find(order=>order.orderId==='order-reconcile-urgent');
    assert.equal(item.urgentDeliveryVerification,true);
    const response=()=>handleAdminDeliveryRequest(new Request(
      'https://api.example.test/api/admin/delivery/orders/order-reconcile-urgent/reconcile',
      {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({
        customerConfirmed:true,storeId:'store-1',deliveryDate:dateInIndia(1),
        confirmationNote:'Customer says delivery still pending and address reconfirmed.'
      })}
    ),{DB:db});
    await assert.rejects(response(),/entered fulfilment/i);
    const order=db.db.prepare("SELECT assigned_store_id,delivery_status,payment_status FROM orders WHERE id='order-reconcile-urgent'").get();
    assert.equal(order.assigned_store_id,null);
    assert.equal(order.delivery_status,'Out for Delivery');
    assert.equal(order.payment_status,'Collected');
  } finally { db.close(); }
});
