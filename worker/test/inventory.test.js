import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderItems, updateOrder } from '../src/index.js';
import { prepareCheckoutDelivery } from '../src/delivery-scheduling.js';

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

test('catalogue validation defers tracked stock to the selected store inventory',async()=>{
  const env={DB:mockProducts([
    {id:'p1',name:'Rice',unit:'kg',price:450,emoji:'🍚',stock_managed:1,stock_quantity:1,low_stock_threshold:1}
  ])};
  const result=await validateOrderItems(env,[{id:'p1',qty:2}]);
  assert.equal(result.items[0].stockReservedQty,2,
    'the legacy aggregate count is not authoritative for store-managed inventory');
});

test('checkout rejects a basket when the selected active store lacks enough tracked stock',async()=>{
  const products=[{id:'p1',name:'Rice',stock_managed:1}];
  const stores=[{id:'store-1',name:'Test Store',latitude:17.385,longitude:78.4867,service_radius_km:5}];
  const inventory=[{store_id:'store-1',product_id:'p1',stock_quantity:1,reserved_qty:0}];
  const env={DB:{
    prepare(sql){
      let args=[];
      const query={
        bind(...values){args=values;return query;},
        async all(){
          if(sql.includes('SELECT id,stock_managed FROM products'))return{results:products.filter(p=>args.includes(p.id))};
          if(sql.includes('FROM delivery_stores WHERE is_active=1'))return{results:stores};
          if(sql.includes('FROM delivery_store_inventory i LEFT JOIN'))return{results:inventory};
          return{results:[]};
        },
        async first(){return null;},
        async run(){return{meta:{changes:1}};}
      };
      return query;
    }
  }};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [year,month,day]=today.split('-').map(Number);
  const tomorrow=new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
  await assert.rejects(
    ()=>prepareCheckoutDelivery(env,{preferredDeliveryDate:tomorrow,address:{latitude:17.385,longitude:78.4867}},[{id:'p1',qty:2}]),
    /not available from nearby stores/i
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
