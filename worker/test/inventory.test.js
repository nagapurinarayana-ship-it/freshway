import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderItems, updateOrder } from '../src/index.js';

function mockProducts(rows){
  return {
    prepare(sql){
      return {
        bind(){
          return {
            async all(){ return { results: rows }; },
            async first(){ return rows[0] || null; },
            async run(){ return { meta:{changes:1} }; }
          };
        }
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

test('cancelling an order restores its reserved stock in the same database batch',async()=>{
  const calls=[];
  const env={
    DB:{
      prepare(sql){
        calls.push(sql);
        return {
          bind(...args){
            return {
              async all(){
                if(sql.includes('SELECT delivery_status'))return {results:[{delivery_status:'New',payment_status:'Not Collected',delivery_plan:'Tomorrow',customer_id:'c1'}]};
                if(sql.includes('SELECT product_id,SUM'))return {results:[{product_id:'p1',stock_reserved_qty:2}]};
                return {results:[]};
              },
              async first(){return null;},
              async run(){return {meta:{changes:1}}}
            };
          }
        };
      },
      async batch(statements){
        assert.equal(statements.length,2);
        assert.match(calls[calls.length-2],/stock_quantity=stock_quantity\+\?/);
        assert.match(calls[calls.length-1],/UPDATE orders SET/);
        return [{meta:{changes:1}},{meta:{changes:1}}];
      }
    }
  };
  const result=await updateOrder(env,'FW-00000001',{status:'Cancelled'});
  assert.equal(result.status,'Cancelled');
});
