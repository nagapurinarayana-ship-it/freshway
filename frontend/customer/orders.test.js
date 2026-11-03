const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(__dirname+'/orders.js','utf8'),context);
const api=context.window.FreshWayCustomerOrders;
assert.equal(typeof api.buyAgainPlan,'function');

const products=[
  {id:42,name:'Groundnut oil',unit:'5 L',price:1899,active:1,stock_status:'in_stock'},
  {id:'rice',name:'HMT Rice',unit:'5 kg',price:650,active:1,stock_status:'in_stock'},
  {id:'hidden',name:'Hidden product',price:100,active:0,stock_status:'in_stock'},
  {id:'boolean-hidden',name:'Boolean hidden',price:100,active:false,stock_status:'in_stock'},
  {id:'empty',name:'Out of stock product',price:100,active:1,stock_status:'out_of_stock'}
];
const order={id:'FW-1',status:'Delivered',items:[
  {id:'42',name:'Groundnut oil',qty:2,price:1400},
  {id:'rice',name:'HMT Rice',qty:1,price:500},
  {id:'gone',name:'Removed product',qty:1},
  {id:'hidden',name:'Hidden product',qty:1},
  {id:'empty',name:'Out of stock product',qty:1},
  {id:'boolean-hidden',name:'Boolean hidden',qty:1}
]};
const plan=api.buyAgainPlan(order,products,{'42':1});
assert.equal(plan.eligible,true);
assert.deepEqual(JSON.parse(JSON.stringify(plan.cart)),{'42':3,rice:1});
assert.equal(plan.addedQuantity,3);
assert.deepEqual(JSON.parse(JSON.stringify(plan.additions.map(x=>({id:x.id,quantity:x.quantity,price:x.product.price})))),[
  {id:'42',quantity:2,price:1899},
  {id:'rice',quantity:1,price:650}
],'Buy Again uses current catalogue prices, not historical order prices');
assert.deepEqual(JSON.parse(JSON.stringify(plan.unavailable)),['Removed product','Hidden product','Out of stock product','Boolean hidden']);

const capped=api.buyAgainPlan({status:'Delivered',items:[{id:'42',name:'Groundnut oil',qty:3}]},products,{'42':98});
assert.deepEqual(JSON.parse(JSON.stringify(capped.cart)),{'42':99});
assert.equal(capped.addedQuantity,1);
assert.deepEqual(JSON.parse(JSON.stringify(capped.quantityLimit)),['Groundnut oil']);

for(const status of ['New','Confirmed','Processing','Cancelled','Out for Delivery']){
  const rejected=api.buyAgainPlan({status,items:[{id:'42',qty:1}]},products,{});
  assert.equal(rejected.eligible,false,status+' orders cannot trigger Buy Again');
  assert.equal(rejected.additions.length,0);
}
assert.equal(api.buyAgainPlan({status:'delivered',items:[]},products,{}).eligible,true,'delivered status is case-insensitive');
console.log('customer Buy Again catalogue, availability, merge and quantity-limit tests passed');
