import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{normalizePaymentFilter,validateOrderPatch} from '../src/index.js';

test('order lifecycle accepts the database status and payment vocabulary',()=>{
  assert.doesNotThrow(()=>validateOrderPatch(
    {delivery_status:'New',payment_status:'Not Collected'},
    {status:'Confirmed'}
  ));
  assert.doesNotThrow(()=>validateOrderPatch(
    {delivery_status:'Processing',payment_status:'Not Collected'},
    {status:'Ready'}
  ));
  assert.doesNotThrow(()=>validateOrderPatch(
    {delivery_status:'Delivered',payment_status:'Not Collected'},
    {payment:'Collected'}
  ));
  assert.equal(normalizePaymentFilter('Pending'),'Not Collected');
  assert.equal(normalizePaymentFilter('Collected'),'Collected');
});

test('order lifecycle rejects unsafe transitions',()=>{
  assert.throws(
    ()=>validateOrderPatch({delivery_status:'New',payment_status:'Not Collected'},{status:'Delivered'}),
    /Cannot change New order to Delivered/
  );
  assert.throws(
    ()=>validateOrderPatch({delivery_status:'Processing',payment_status:'Not Collected'},{payment:'Collected'}),
    /only after delivery/i
  );
  assert.throws(
    ()=>validateOrderPatch({delivery_status:'Delivered',payment_status:'Collected'},{payment:'Not Collected'}),
    /Collected cash cannot/i
  );
  assert.throws(
    ()=>validateOrderPatch({delivery_status:'New',payment_status:'Not Collected'},{payment:'Refunded'}),
    /Only collected payments/i
  );
  assert.throws(
    ()=>validateOrderPatch({delivery_status:'New',payment_status:'Not Collected'},{payment:'Cancelled'}),
    /only for a cancelled order/i
  );
});

test('owner order endpoint applies pagination and legacy payment filter normalization',async()=>{
  const calls=[];
  const env={
    ADMIN_TOKEN:'fixture-admin',
    APP_ORIGIN:'https://freshway-f32.pages.dev',
    DB:{
      prepare(sql){
        calls.push(sql);
        return {
          bind(...args){
            return {
              async first(){return sql.includes('COUNT(*)')?{total:2}:null},
              async all(){
                if(sql.includes('SELECT o.id'))return {results:[{
                  id:'FW-00000001',customer_id:'c1',customer_name:'Test',customer_phone:'911234567890',
                  total:500,payment_status:'Not Collected',delivery_status:'New',delivery_plan:'Tomorrow',
                  created_at:'2026-10-07 10:00:00',updated_at:'2026-10-07 10:00:00',payment_collected_at:null,
                  house:'1',area:'Main Road',city:'Hyderabad',pincode:'500001',landmark:'',note:''
                }]};
                if(sql.includes('SELECT order_id'))return {results:[{
                  order_id:'FW-00000001',product_id:'p1',name:'Rice',unit:'kg',qty:1,price:500,line_total:500
                }]};
                return {results:[]};
              },
              async run(){return {meta:{changes:1}}}
            };
          }
        };
      }
    }
  };
  const response=await handler.fetch(
    new Request('https://api.example.test/api/admin/orders?page=2&limit=1&payment=Pending&sort=newest',{
      headers:{'X-Freshway-Admin-Token':'fixture-admin'}
    }),
    env,
    {}
  );
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.pagination.page,2);
  assert.equal(data.pagination.limit,1);
  assert.equal(data.pagination.total,2);
  assert.equal(data.orders[0].payment,'Not Collected');
  assert.ok(calls.some(sql=>sql.includes('payment_status=?')));
});
