const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const context={window:{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('frontend/customer/cart-persistence.js','utf8'),context);
const state={
  cart:{'42':1},
  cartProducts:{'42':{id:'42',name:'Groundnut oil/5ltrs',unit:'kg',price:1850,emoji:'🛢️',unavailable:false}}
};
let products=[];
let saves=0, renders=0, bars=0;
const persistence=context.window.FreshWayCustomerCartPersistence.create({
  state,
  getProducts:()=>products,
  setProducts:next=>{products=next},
  save:()=>{saves++},
  renderProducts:()=>{renders++},
  renderCart:()=>{renders++},
  updateCartBar:()=>{bars++},
  isCartActive:()=>false
});
const cleared=persistence.clear();
assert.deepEqual(JSON.parse(JSON.stringify(state.cart)),{'42':1},'catalogue failure must never delete cart quantities');
assert.equal(state.cartProducts['42'].price,1850,'catalogue failure preserves saved item price');
assert.equal(cleared.removed,0);
const numericProduct={id:42,name:'Groundnut oil/5ltrs',unit:'kg',price:1800,emoji:'🛢️',image_url:'/api/catalogue/images/products/42?v=image-v1'};
const available=persistence.setProducts([numericProduct]);
assert.equal(available.unavailable,0,'numeric catalogue IDs match string cart keys');
assert.equal(state.cart['42'],1);
assert.equal(state.cartProducts['42'].price,1800);
assert.equal(state.cartProducts['42'].image_url,'/api/catalogue/images/products/42?v=image-v1','versioned image URLs persist for offline cart rendering');
persistence.syncQuotedItems([{id:42,name:'Groundnut oil/5ltrs',unit:'kg',qty:1,price:1850,lineTotal:1850}]);
assert.equal(state.cartProducts['42'].name,'Groundnut oil/5ltrs');
assert.equal(state.cartProducts['42'].price,1850);
assert.equal(products[0].price,1850);
const missing=persistence.setProducts([]);
assert.equal(missing.unavailable,1,'a genuinely missing product is flagged rather than silently removed');
assert.equal(state.cart['42'],1,'missing products are retained so the customer can see and remove them');
assert.equal(state.cartProducts['42'].unavailable,true);
persistence.removeProduct('42');
assert.equal(Object.hasOwn(state.cartProducts,'42'),false,'explicit customer removal clears only the item snapshot');
assert.ok(saves>=2,'snapshot changes are persisted');
assert.ok(renders>0,'catalogue changes rerender the relevant customer views');
assert.ok(bars>0,'cart totals are refreshed after catalogue changes');
console.log('customer cart persistence and empty-catalogue regression passed');
