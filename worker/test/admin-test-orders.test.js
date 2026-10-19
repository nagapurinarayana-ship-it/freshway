import test from 'node:test';
import assert from 'node:assert/strict';
import { orders, updateOrder } from '../src/admin-orders.js';

function fixture({testFlag=0}={}) {
  const calls=[];
  const row={id:'FW-TEST-1',customer_id:'cust-test',customer_name:'Sample Test',customer_phone:'911234567890',is_test_order:testFlag,total:120,payment_status:'Not Collected',delivery_status:'New',delivery_plan:'Tomorrow',created_at:'2026-10-18 10:00:00',updated_at:'2026-10-18 10:00:00',payment_collected_at:null,house:'1',area:'Test Road',city:'Hyderabad',pincode:'500001',landmark:'',note:''};
  const DB={prepare(sql){const call={sql,binds:[]};calls.push(call);return{bind(...binds){call.binds=binds;return{
    async first(){if(sql.includes('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order'))return{delivery_status:'New',payment_status:'Not Collected',delivery_plan:'Tomorrow',customer_id:'cust-test',is_test_order:testFlag};if(sql.includes('COUNT(*)'))return{count:1};return null},
    async all(){if(sql.includes('SELECT COUNT(*) count'))return{results:[{count:1}]};if(sql.includes('SELECT o.id'))return{results:[row]};if(sql.includes('SELECT order_id'))return{results:[{order_id:row.id,product_id:'rice',name:'Rice',unit:'kg',qty:1,price:120,line_total:120}]};return{results:[]}},
    async run(){return{meta:{changes:1}}}
  }}}}};
  return{env:{DB},calls};
}

test('owner live-order query explicitly excludes test orders',async()=>{
  const {env,calls}=fixture();
  const result=await orders(env,new URL('https://example.test/api/admin/orders'));
  assert.equal(result.orders[0].isTestOrder,false);
  assert.ok(calls.some(c=>c.sql.includes('o.is_test_order=0')));
});

test('owner Test Orders query selects only classified test orders',async()=>{
  const {env,calls}=fixture({testFlag:1});
  const result=await orders(env,new URL('https://example.test/api/admin/orders?testOrders=1'));
  assert.equal(result.orders[0].isTestOrder,true);
  assert.ok(calls.some(c=>c.sql.includes('o.is_test_order=1')));
});

test('normal delivery status updates remain unchanged when no test flag is sent',async()=>{
  const {env}=fixture();
  const result=await updateOrder(env,'FW-TEST-1',{status:'Confirmed'});
  assert.equal(result.status,'Confirmed');
  assert.equal(result.isTestOrder,0);
  assert.equal(result.testClassificationChanged,false);
});

test('owner can mark and unmark a test order without changing delivery/payment status',async()=>{
  const {env,calls}=fixture();
  const result=await updateOrder(env,'FW-TEST-1',{isTestOrder:true});
  assert.equal(result.isTestOrder,1);
  assert.equal(result.testClassificationChanged,true);
  const update=calls.find(c=>c.sql.startsWith('UPDATE orders SET'));
  assert.ok(update);
  assert.ok(update.sql.includes('is_test_order=?'));
  assert.deepEqual(update.binds.slice(0,1),[1]);
  assert.match(update.sql,/^UPDATE orders SET is_test_order=\?,updated_at=CURRENT_TIMESTAMP WHERE id=\? AND delivery_status IS \? AND payment_status IS \? AND delivery_plan IS \? AND is_test_order IS \?$/);
  assert.deepEqual(update.binds,[1,'FW-TEST-1','New','Not Collected','Tomorrow',0]);
});
