const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('app.js','utf8');
assert.match(source,/const cartItems=\(\)=>catalogueCart\.items\(state,PRODUCTS\)/,
  'cart rendering must use the dedicated catalogue/cart boundary');
assert.match(source,/refreshCheckoutQuote\?\.\(cartItems\(\),money\)/,
  'checkout entry must request a fresh server quote for the restored cart');
const storageSource=fs.readFileSync('frontend/customer/storage.js','utf8');
assert.match(storageSource,/cart:value\.cart&&typeof value\.cart==='object'\?value\.cart:\{\}/,
  'saved cart quantities must be restored from local storage');
const cartSource=fs.readFileSync('frontend/customer/catalogue-cart.js','utf8');
assert.match(cartSource,/state\?\.cartProducts/,
  'cart rendering must fall back to persisted product snapshots when the catalogue has not loaded after refresh');

const context={window:{}};
vm.runInNewContext(cartSource,context);
const state={cart:{oil:1},cartProducts:{oil:{id:'oil',name:'Groundnut oil/5ltrs',unit:'kg',price:1850,emoji:'🛒'}}};
const items=context.window.FreshWayCatalogueCart.items(state,[]);
assert.equal(items.length,1,'saved item remains visible while catalogue request is unavailable');
assert.equal(items[0].product.price,1850,'saved product snapshot preserves its last known price until server quote refreshes');
console.log('cart refresh persistence regression assertions passed');
