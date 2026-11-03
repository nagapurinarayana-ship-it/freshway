import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0049_purge_six_inactive_fruit_products.sql',import.meta.url),'utf8');

function createDb(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(schema);
  db.exec(`
    INSERT INTO categories(id,name,slug,active) VALUES ('cat-fruit','Fruits','fruits',0);
    INSERT INTO products(id,name,unit,price,emoji,active,category_id,stock_managed,stock_quantity)
    VALUES
      ('mango','Mango','kg',100,'🥭',0,'cat-fruit',0,0),
      ('orange','Orange','kg',80,'🍊',0,'cat-fruit',0,0),
      ('papaya','Papaya','kg',60,'🍈',0,'cat-fruit',0,0),
      ('pineapple','Pineapple','piece',90,'🍍',0,'cat-fruit',0,0),
      ('pomegranate','Pomegranate','kg',150,'🍎',0,'cat-fruit',0,0),
      ('watermelon','Watermelon','kg',40,'🍉',0,'cat-fruit',0,0),
      ('oil-groundnut','Groundnut Oil','litre',399,'🫙',1,'cat-oils',1,20),
      ('oil-coconut','Coconut Oil','litre',799,'🥥',1,'cat-oils',1,0),
      ('rice-hmt','HMT Rice','kg',70,'🍚',1,'cat-rice',1,20),
      ('rice-sona','Sona Masuri','kg',65,'🍚',1,'cat-rice',1,0);
    UPDATE categories SET active=0 WHERE id='cat-rice';

    INSERT INTO delivery_stores(id,name,address,latitude,longitude,service_radius_km,is_active)
    VALUES('store-1','Mancherial Store','Mancherial',19.0,79.0,5,1);
    INSERT INTO delivery_store_inventory(store_id,product_id,stock_quantity)
    VALUES
      ('store-1','oil-coconut',8),
      ('store-1','rice-sona',7);
    INSERT INTO delivery_store_catalogue(store_id,product_id,is_available,price_override)
    VALUES
      ('store-1','mango',1,110),('store-1','orange',1,90),
      ('store-1','papaya',1,70),('store-1','pineapple',1,95),
      ('store-1','pomegranate',1,160),('store-1','watermelon',1,45),
      ('store-1','oil-groundnut',1,410),('store-1','oil-coconut',1,820),
      ('store-1','rice-hmt',1,77),('store-1','rice-sona',0,66);

    INSERT INTO customers(id,name,phone) VALUES('customer-1','Test Customer','9999999999');
    INSERT INTO addresses(customer_id,house,area,city,pincode)
    VALUES('customer-1','1-1','Test Area','Mancherial','504208');

    INSERT INTO delivery_slots(id,store_id,delivery_date,start_minute,end_minute,capacity,is_active)
    VALUES('slot-1','store-1','2026-11-04',600,720,10,1);

    INSERT INTO coupons(id,code,title,discount_amount,first_order_only,starts_on,active)
    VALUES('coupon-1','TEST50','Test Coupon',50,1,'2026-01-01',1);

    INSERT INTO orders(id,customer_id,address_id,customer_name,customer_phone,total,delivery_status)
    SELECT 'ORDER-MIXED','customer-1',id,'Test Customer','9999999999',569,'New' FROM addresses WHERE customer_id='customer-1';
    INSERT INTO order_items(order_id,product_id,name,unit,qty,price,line_total,stock_reserved_qty)
    VALUES
      ('ORDER-MIXED','mango','Mango','kg',1,100,100,0),
      ('ORDER-MIXED','oil-groundnut','Groundnut Oil','litre',1,399,399,1),
      ('ORDER-MIXED','rice-hmt','HMT Rice','kg',1,70,70,1);

    INSERT INTO orders(id,customer_id,address_id,customer_name,customer_phone,total,delivery_status,assigned_store_id)
    SELECT 'ORDER-STORE','customer-1',id,'Test Customer','9999999999',929,'New','store-1' FROM addresses WHERE customer_id='customer-1';
    INSERT INTO order_items(order_id,product_id,name,unit,qty,price,line_total)
    VALUES
      ('ORDER-STORE','papaya','Papaya','kg',1,60,60),
      ('ORDER-STORE','oil-coconut','Coconut Oil','litre',1,799,799),
      ('ORDER-STORE','rice-sona','Sona Masuri','kg',1,65,65);
    INSERT INTO delivery_store_inventory_reservations(id,order_id,store_id,product_id,qty,status)
    VALUES
      ('res-coconut','ORDER-STORE','store-1','oil-coconut',1,'reserved'),
      ('res-sona','ORDER-STORE','store-1','rice-sona',1,'reserved');
    INSERT INTO delivery_slot_reservations(id,order_id,slot_id,status)
    VALUES('slot-res','ORDER-STORE','slot-1','reserved');

    INSERT INTO orders(id,customer_id,address_id,customer_name,customer_phone,total,delivery_status)
    SELECT 'ORDER-DELIVERED','customer-1',id,'Test Customer','9999999999',479,'Delivered' FROM addresses WHERE customer_id='customer-1';
    INSERT INTO order_items(order_id,product_id,name,unit,qty,price,line_total,stock_reserved_qty)
    VALUES
      ('ORDER-DELIVERED','orange','Orange','kg',1,80,80,0),
      ('ORDER-DELIVERED','oil-groundnut','Groundnut Oil','litre',1,399,399,4);

    INSERT INTO orders(id,customer_id,address_id,customer_name,customer_phone,total,delivery_status)
    SELECT 'ORDER-UNRELATED','customer-1',id,'Test Customer','9999999999',399,'New' FROM addresses WHERE customer_id='customer-1';
    INSERT INTO order_items(order_id,product_id,name,unit,qty,price,line_total)
    VALUES('ORDER-UNRELATED','oil-groundnut','Groundnut Oil','litre',1,399,399);

    INSERT INTO invoices(id,order_id,customer_id,invoice_number,document_type,financial_year,issue_date,seller_snapshot,buyer_snapshot,totals_snapshot)
    VALUES
      ('INV-MIXED','ORDER-MIXED','customer-1','FW/26-27/10','commercial_invoice','2026-27','2026-11-03','{}','{}','{}'),
      ('INV-STORE','ORDER-STORE','customer-1','FW/26-27/11','commercial_invoice','2026-27','2026-11-03','{}','{}','{}'),
      ('INV-DELIVERED','ORDER-DELIVERED','customer-1','FW/26-27/12','commercial_invoice','2026-27','2026-11-03','{}','{}','{}');
    INSERT INTO invoice_items(invoice_id,product_id,name,unit,qty,unit_price_paise,gross_paise,taxable_paise)
    VALUES
      ('INV-MIXED','mango','Mango','kg',1,100,100,100),
      ('INV-MIXED','oil-groundnut','Groundnut Oil','litre',1,399,399,399),
      ('INV-STORE','papaya','Papaya','kg',1,60,60,60),
      ('INV-DELIVERED','orange','Orange','kg',1,80,80,80);

    INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount,status)
    VALUES('redeem-1','coupon-1','customer-1','ORDER-MIXED','TEST50',50,'released');
    INSERT INTO first_order_coupon_claims(customer_id,order_id,coupon_id)
    VALUES('customer-1','ORDER-MIXED','coupon-1');
    INSERT INTO order_action_requests(id,order_id,customer_id,request_type)
    VALUES('action-1','ORDER-STORE','customer-1','cancellation');
    INSERT INTO order_audit_events(id,order_id,actor_type,action)
    VALUES('audit-1','ORDER-STORE','system','order_created');
    INSERT INTO order_operational_flags(id,order_id,flag_type)
    VALUES('flag-1','ORDER-STORE','test_flag');
    INSERT INTO notification_events(event_key,audience,customer_id,order_id,event_type,title,body)
    VALUES('event-1','customer','customer-1','ORDER-STORE','order_created','Order','Created');
    INSERT INTO invoice_sequences(financial_year,last_number) VALUES('2026-27',12)
    ON CONFLICT(financial_year) DO UPDATE SET last_number=12;
  `);
  return db;
}

test('migration removes the six inactive products and every entire linked order and child record',()=>{
  const db=createDb();
  try{
    db.exec(migration);

    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM products WHERE id IN ('mango','orange','papaya','pineapple','pomegranate','watermelon')").get().n),0);
    assert.deepEqual(db.prepare("SELECT id FROM orders ORDER BY id").all().map(x=>x.id),['ORDER-UNRELATED']);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM order_items WHERE order_id<>'ORDER-UNRELATED'").get().n),0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM invoices").get().n),0);
    for(const table of [
      'invoice_items','coupon_redemptions','first_order_coupon_claims',
      'delivery_store_inventory_reservations','delivery_slot_reservations',
      'order_action_requests','order_audit_events','order_operational_flags','notification_events'
    ]){
      assert.equal(Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),0,table+' must be cleared');
    }
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM order_address_snapshots").get().n),0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM delivery_store_inventory WHERE product_id IN ('mango','orange','papaya','pineapple','pomegranate','watermelon')").get().n),0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM delivery_store_catalogue WHERE product_id IN ('mango','orange','papaya','pineapple','pomegranate','watermelon')").get().n),0);
  }finally{db.close()}
});

test('Oil and Rice products, prices, local availability and overrides remain unchanged, even for an inactive central category',()=>{
  const db=createDb();
  try{
    const before=db.prepare("SELECT id,price,active,stock_managed FROM products WHERE id IN ('oil-groundnut','oil-coconut','rice-hmt','rice-sona') ORDER BY id").all();
    const storeBefore=db.prepare("SELECT product_id,is_available,price_override FROM delivery_store_catalogue WHERE store_id='store-1' AND product_id IN ('oil-groundnut','oil-coconut','rice-hmt','rice-sona') ORDER BY product_id").all();
    const riceCategoryBefore=db.prepare("SELECT id,name,slug,active FROM categories WHERE id='cat-rice'").get();

    db.exec(migration);

    const after=db.prepare("SELECT id,price,active,stock_managed FROM products WHERE id IN ('oil-groundnut','oil-coconut','rice-hmt','rice-sona') ORDER BY id").all();
    const storeAfter=db.prepare("SELECT product_id,is_available,price_override FROM delivery_store_catalogue WHERE store_id='store-1' AND product_id IN ('oil-groundnut','oil-coconut','rice-hmt','rice-sona') ORDER BY product_id").all();
    const riceCategoryAfter=db.prepare("SELECT id,name,slug,active FROM categories WHERE id='cat-rice'").get();
    assert.deepEqual(after,before);
    assert.deepEqual(storeAfter,storeBefore);
    assert.deepEqual(riceCategoryAfter,riceCategoryBefore);
  }finally{db.close()}
});

test('legacy stock is restored for unfulfilled mixed orders, delivered stock is not, and store stock is not physically changed',()=>{
  const db=createDb();
  try{
    db.exec(migration);
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='oil-groundnut'").get().stock_quantity),21,
      'one unfulfilled legacy reservation is restored; delivered order quantity is not credited');
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='rice-hmt'").get().stock_quantity),21);
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='oil-coconut'").get().stock_quantity),8,
      'store aggregate is refreshed after its active reservation is released');
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='rice-sona'").get().stock_quantity),7);
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM delivery_store_inventory WHERE store_id='store-1' AND product_id='oil-coconut'").get().stock_quantity),8,
      'physical store quantity remains unchanged');
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM delivery_store_inventory WHERE store_id='store-1' AND product_id='rice-sona'").get().stock_quantity),7);
  }finally{db.close()}
});

test('invoice sequence remains intact and deleted product/order markers do not remain',()=>{
  const db=createDb();
  try{
    db.exec(migration);
    assert.equal(Number(db.prepare("SELECT last_number FROM invoice_sequences WHERE financial_year='2026-27'").get().last_number),12);
    for(const table of ['fw_purge_20261103_products','fw_purge_20261103_orders','fw_purge_20261103_store_stock_products']){
      assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n),0);
    }
  }finally{db.close()}
});

test('Oil and Rice products are protected even if marked inactive',()=>{
  const db=createDb();
  try{
    db.prepare("UPDATE products SET active=0 WHERE id='rice-hmt'").run();
    db.exec(migration);
    assert.ok(db.prepare("SELECT id FROM products WHERE id='rice-hmt'").get());
    assert.equal(Number(db.prepare("SELECT active FROM products WHERE id='rice-hmt'").get().active),0);
  }finally{db.close()}
});


test('legacy seeded fruit products are purged even when their original seed active flag is set',()=>{
  const db=createDb();
  try{
    db.prepare("UPDATE products SET active=1 WHERE id IN ('mango','orange','papaya','pineapple','pomegranate','watermelon')").run();
    db.exec(migration);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM products WHERE id IN ('mango','orange','papaya','pineapple','pomegranate','watermelon')").get().n),0);
  }finally{db.close()}
});
