import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderItems, updateOrder } from '../src/index.js';

function mockProducts(rows){
  return {
    prepare(sql){
      const result={
        async all(){ return { results: rows }; },
        async first(){ return rows[0] || null; },
        async run(){ return { meta:{changes:1} }; }
      };
      return {
        ...result,
        bind(){ return result; }
      };
    }
  };
}

test('checkout uses authoritative database price and reserves tracked stock',async()=>{
  const env={DB:mockProducts([
    {id:'p1',name:'Rice',unit:'kg',price:450,emoji:'🍚',stock_managed:1,stock_quantity:4,low_stock_threshold:1}
  ])};
  const result=await validateOrderItems(env,[{id:'p1',qty:2}]);
  assert.equal(result.total,900);
  assert.equal(result.items[0].price,450);
  assert.equal(result.items[0].stockReservedQty,2);
});

test('checkout rejects tracked stock that is insufficient',async()=>{
  const env={DB:mockProducts([
    {id:'p1',name:'Rice',unit:'kg',price:450,emoji:'🍚',stock_managed:1,stock_quantity:1,low_stock_threshold:1}
  ])};
  await assert.rejects(
    ()=>validateOrderItems(env,[{id:'p1',qty:2}]),
    /Not enough stock for Rice/i
  );
});

test('legacy untracked products retain ordering behavior without reservation',async()=>{
  const env={DB:mockProducts([
    {id:'p1',name:'Rice',unit:'kg',price:450,emoji:'🍚',stock_managed:0,stock_quantity:0,low_stock_threshold:5}
  ])};
  const result=await validateOrderItems(env,[{id:'p1',qty:99}]);
  assert.equal(result.total,44550);
  assert.equal(result.items[0].stockReservedQty,0);
});


test('cancelling an order saves the cancellation before conditional stock restoration in one database batch',async()=>{
  const calls=[];
  const env={
    DB:{
      prepare(sql){
        const call={sql,binds:[]};calls.push(call);
        return {
          bind(...args){
            call.binds=args;
            return {
              async all(){
                if(sql.includes('SELECT oi.product_id,SUM'))return {results:[{product_id:'p1',stock_reserved_qty:2,product_exists:'p1'}]};
                return {results:[]};
              },
              async first(){
                if(sql.includes('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order'))return {
                  delivery_status:'New',payment_status:'Not Collected',delivery_plan:'Tomorrow',customer_id:'c1',is_test_order:0,stock_release_token:null,stock_released_at:null
                };
                return null;
              },
              async run(){return {meta:{changes:1}}}
            };
          }
        };
      },
      async batch(statements){
        assert.equal(statements.length,2);
        assert.match(statements[0].sql,/UPDATE orders SET/,'order cancellation must be first in the atomic batch');
        assert.match(statements[0].sql,/stock_release_token=\?/);
        assert.match(statements[1].sql,/stock_quantity=stock_quantity\+\?/);
        assert.match(statements[1].sql,/stock_release_token=\?/,'stock restoration must be conditional on this cancellation token');
        assert.ok(statements[1].sql.includes("delivery_status='Cancelled'"));
        assert.equal(statements[1].binds[0],2);
        assert.equal(statements[1].binds[1],'p1');
        return [{meta:{changes:1}},{meta:{changes:1}}];
      }
    }
  };
  const result=await updateOrder(env,'FW-00000001',{status:'Cancelled'});
  assert.equal(result.status,'Cancelled');
  assert.equal(result.stockReleased,true);
});

test('a concurrent cancellation conflict does not restore stock twice',async()=>{
  let stockWriteAttempts=0;
  const env={
    DB:{
      prepare(sql){
        return {
          bind(...args){
            return {
              async first(){
                if(sql.includes('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order'))return {
                  delivery_status:'New',payment_status:'Not Collected',delivery_plan:'Tomorrow',customer_id:'c1',is_test_order:0,stock_release_token:null,stock_released_at:null
                };
                return null;
              },
              async all(){
                if(sql.includes('SELECT oi.product_id,SUM'))return {results:[{product_id:'p1',stock_reserved_qty:2,product_exists:'p1'}]};
                return {results:[]};
              },
              async run(){return {meta:{changes:1}}}
            };
          }
        };
      },
      async batch(statements){
        assert.equal(statements.length,2);
        stockWriteAttempts++;
        // Another request won the compare-and-set. The token-gated stock statement is a no-op.
        return [{meta:{changes:0}},{meta:{changes:0}}];
      }
    }
  };
  await assert.rejects(()=>updateOrder(env,'FW-00000001',{status:'Cancelled'}),/ORDER_CONFLICT/);
  assert.equal(stockWriteAttempts,1);
});

test('customer product responses expose stock state without exact inventory counts',async()=>{
  const response=await (await import('../src/index.js')).default.fetch(
    new Request('https://api.example.test/api/products'),
    {APP_ORIGIN:'https://freshway-f32.pages.dev',DB:mockProducts([
      {id:'p1',name:'Rice',unit:'kg',price:450,emoji:'🍚',active:1,stock_managed:1,stock_quantity:2,low_stock_threshold:2}
    ])},
    {}
  );
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.products[0].stock_status,'low_stock');
  assert.equal('stock_quantity' in data.products[0],false);
});
