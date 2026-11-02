import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getStoreCatalogueRows, getStoreProductRows, saveStoreCatalogue } from '../src/store-catalogue.js';
import { handleCustomerDeliveryRequest, handleAdminDeliveryRequest } from '../src/delivery-scheduling.js';
import { handleCustomerDeliveryOffersRequest } from '../src/delivery-offers.js';

class SQLiteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    this.db.exec(`
      INSERT INTO products (id,name,unit,price,emoji,active,category_id,stock_managed,stock_quantity,low_stock_threshold,hsn_code,gst_rate_bps,gst_rate_confirmed)
      VALUES ('oil-1','Groundnut Oil','litre',200,'🫙',1,'cat-oils',1,10,2,'',0,0);
      INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active)
      VALUES
        ('store-near','Nearest Store','Near',17.385044,78.486671,5,1),
        ('store-next','Next Store','Next',17.390044,78.491671,5,1);
      INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity)
      VALUES ('store-near','oil-1',5),('store-next','oil-1',8);
      INSERT INTO customers (id,name,phone) VALUES ('customer-1','Test Customer','919999999999');
      INSERT INTO addresses (customer_id,house,area,city,pincode,latitude,longitude)
      VALUES ('customer-1','1-1','Test Area','Hyderabad','500072',17.385044,78.486671);
    `);
  }
  prepare(sql) {
    const owner=this;let args=[];
    const statement={
      bind(...values){args=values;return statement;},
      executeSync(){const result=owner.db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid||0)}};},
      async run(){return statement.executeSync();},
      async first(){return owner.db.prepare(sql).get(...args)??null;},
      async all(){return {results:owner.db.prepare(sql).all(...args)};}
    };
    return statement;
  }
  async batch(statements){
    this.db.exec('BEGIN');
    try{const result=statements.map(statement=>statement.executeSync());this.db.exec('COMMIT');return result;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  close(){this.db.close();}
}

const jsonRequest=(url,body,method='POST')=>new Request(url,{
  method,headers:{'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)
});

test('store catalogue uses the central price by default and accepts an independent local override',async()=>{
  const d1=new SQLiteD1();
  try{
    const initial=await getStoreCatalogueRows({DB:d1},'store-near');
    assert.equal(initial.length,1);
    assert.equal(initial[0].price_override,null);
    assert.equal(Number(initial[0].effective_price),200);
    await saveStoreCatalogue({DB:d1},'store-near',[{productId:'oil-1',isAvailable:true,priceOverride:175}]);
    const items=await getStoreProductRows({DB:d1},'store-near',new Map([['oil-1',2]]));
    assert.equal(items[0].price,175);
    assert.equal(items[0].lineTotal,350);
    await saveStoreCatalogue({DB:d1},'store-near',[{productId:'oil-1',isAvailable:true,priceOverride:null}]);
    const reset=await getStoreProductRows({DB:d1},'store-near',new Map([['oil-1',1]]));
    assert.equal(reset[0].price,200);
  }finally{d1.close()}
});

test('store visibility blocks hidden products from quotes even when physical stock exists',async()=>{
  const d1=new SQLiteD1();
  try{
    await saveStoreCatalogue({DB:d1},'store-near',[{productId:'oil-1',isAvailable:false,priceOverride:150}]);
    const response=await handleCustomerDeliveryOffersRequest(jsonRequest(
      'https://api.example.test/api/checkout/quote',
      {storeId:'store-near',items:[{id:'oil-1',qty:1}]}
    ),{DB:d1},null);
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/not available from the selected store/i);
  }finally{d1.close()}
});

test('checkout quote uses the selected store price instead of the central catalogue price',async()=>{
  const d1=new SQLiteD1();
  try{
    await saveStoreCatalogue({DB:d1},'store-near',[{productId:'oil-1',isAvailable:true,priceOverride:185}]);
    const response=await handleCustomerDeliveryOffersRequest(jsonRequest(
      'https://api.example.test/api/checkout/quote',
      {storeId:'store-near',items:[{id:'oil-1',qty:2}]}
    ),{DB:d1},null);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.pricing.storeId,'store-near');
    assert.equal(result.pricing.items[0].price,185);
    assert.equal(result.pricing.items[0].lineTotal,370);
  }finally{d1.close()}
});

test('availability skips the nearer store when the product is hidden there and selects the next store',async()=>{
  const d1=new SQLiteD1();
  try{
    await saveStoreCatalogue({DB:d1},'store-near',[{productId:'oil-1',isAvailable:false,priceOverride:null}]);
    await saveStoreCatalogue({DB:d1},'store-next',[{productId:'oil-1',isAvailable:true,priceOverride:210}]);
    const response=await handleCustomerDeliveryRequest(jsonRequest(
      'https://api.example.test/api/delivery/availability',
      {address:{latitude:17.385044,longitude:78.486671},items:[{id:'oil-1',qty:1}]}
    ),{DB:d1},'');
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.available,true);
    assert.equal(result.store.id,'store-next');
  }finally{d1.close()}
});

test('Owner store catalogue route reads and saves all central product settings without touching inventory',async()=>{
  const d1=new SQLiteD1();
  try{
    const before=Number(d1.db.prepare("SELECT stock_quantity FROM delivery_store_inventory WHERE store_id='store-near' AND product_id='oil-1'").get().stock_quantity);
    const get=await handleAdminDeliveryRequest(new Request('https://api.example.test/api/admin/delivery/stores/store-near/catalogue'),{DB:d1});
    assert.equal(get.status,200);
    const getData=await get.json();
    assert.equal(getData.items[0].isAvailable,true);
    const update=await handleAdminDeliveryRequest(jsonRequest(
      'https://api.example.test/api/admin/delivery/stores/store-near/catalogue',
      {items:[{productId:'oil-1',isAvailable:false,priceOverride:199}]},
      'PATCH'
    ),{DB:d1});
    assert.equal(update.status,200);
    const updated=await update.json();
    assert.equal(updated.items[0].isAvailable,false);
    assert.equal(updated.items[0].priceOverride,199);
    const after=Number(d1.db.prepare("SELECT stock_quantity FROM delivery_store_inventory WHERE store_id='store-near' AND product_id='oil-1'").get().stock_quantity);
    assert.equal(after,before,'catalogue controls must never write physical inventory');
  }finally{d1.close()}
});

test('store price edits never rewrite historical order item price snapshots',async()=>{
  const d1=new SQLiteD1();
  try{
    const addressId=Number(d1.db.prepare("SELECT id FROM addresses WHERE customer_id='customer-1'").get().id);
    d1.db.prepare(`INSERT INTO orders (id,customer_id,address_id,customer_name,customer_phone,total,items_subtotal,delivery_fee,payment_status,delivery_status,delivery_plan)
      VALUES ('FW-HIST-1','customer-1',?,'Test Customer','9999999999',200,200,0,'Not Collected','New','Tomorrow')`).run(addressId);
    d1.db.prepare(`INSERT INTO order_items (order_id,product_id,name,unit,qty,price,line_total) VALUES ('FW-HIST-1','oil-1','Groundnut Oil','litre',1,200,200)`).run();
    await saveStoreCatalogue({DB:d1},'store-near',[{productId:'oil-1',isAvailable:true,priceOverride:160}]);
    const snapshot=d1.db.prepare("SELECT price,line_total FROM order_items WHERE order_id='FW-HIST-1'").get();
    assert.equal(Number(snapshot.price),200);
    assert.equal(Number(snapshot.line_total),200);
  }finally{d1.close()}
});
