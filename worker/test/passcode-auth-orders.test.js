import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { customerOrdersFromSnapshots } from '../src/passcode-auth.js';

class SQLiteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    this.db.exec(`
      INSERT INTO customers (id,name,phone) VALUES ('customer-1','Current Profile Name','911234567890');
      INSERT INTO addresses (customer_id,house,area,city,pincode,recipient_name,delivery_phone)
        VALUES ('customer-1','Old House','Old Area','Hyderabad','500092','Changed Address Name','919999999999');
      INSERT INTO products (id,name,unit,price,stock_managed,stock_quantity)
        VALUES ('sesame-oil','Sesame oil','kg',520,0,0);
      INSERT INTO orders
        (id,customer_id,address_id,customer_name,customer_phone,total,payment_status,delivery_status,delivery_plan,scheduled_delivery_date)
        VALUES ('FW-ORDERS-1','customer-1',1,'Order-time Name','911234567890',520,'Not Collected','New','Today','2026-10-27');
      INSERT INTO order_address_snapshots
        (order_id,address_id,delivery_phone,house_flat,area,city,pincode,place_id)
        VALUES ('FW-ORDERS-1',1,'911234567890','11','East Brundavan Colony','Hyderabad','500092','place-1');
      INSERT INTO order_items
        (order_id,product_id,name,unit,qty,price,line_total,stock_reserved_qty)
        VALUES ('FW-ORDERS-1','sesame-oil','Sesame oil','kg',1,520,520,0);
    `);
  }
  prepare(sql) {
    const owner=this;
    let args=[];
    const statement={
      bind(...values){args=values;return statement;},
      async all(){return {results:owner.db.prepare(sql).all(...args)};}
    };
    return statement;
  }
  close(){this.db.close();}
}

test('authenticated My Orders query uses the real snapshot schema and returns current order state', async()=>{
  const db=new SQLiteD1();
  try {
    const response=await customerOrdersFromSnapshots(new Request('https://api.example.test/api/orders'),{DB:db},'customer-1');
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.orders.length,1);
    assert.equal(payload.orders[0].id,'FW-ORDERS-1');
    assert.equal(payload.orders[0].status,'New');
    assert.equal(payload.orders[0].scheduledDelivery.date,'2026-10-27');
    assert.equal(payload.orders[0].address.house,'11');
    assert.equal(payload.orders[0].address.area,'East Brundavan Colony');
    assert.equal(payload.orders[0].address.recipientName,'Order-time Name','preserve order-time customer name');
    assert.equal(payload.orders[0].items[0].name,'Sesame oil');
    assert.equal(payload.orders[0].items[0].lineTotal,520);
  } finally { db.close(); }
});
