const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const toast={
  textContent:'',
  visible:false,
  classList:{
    add(name){if(name==='show')toast.visible=true},
    remove(name){if(name==='show')toast.visible=false}
  }
};
const state={cart:false,checkout:false};
const document={
  querySelector(selector){
    if(selector==='#toast')return toast;
    if(selector==='#cartView.active-view')return state.cart?{}:null;
    if(selector==='#checkoutView.active-view')return state.checkout?{}:null;
    return null;
  }
};
let nextTimer=0;
const cleared=[];
const timers=new Map();
const window={__toast:null};
const context={
  window,
  clearTimeout(id){cleared.push(id);timers.delete(id)},
  setTimeout(callback,duration){const id=++nextTimer;timers.set(id,{callback,duration});return id}
};
vm.runInNewContext(fs.readFileSync('frontend/customer/feedback.js','utf8'),context);
const feedback=window.FreshWayCustomerFeedback;
assert.equal(typeof feedback.show,'function');
assert.equal(typeof feedback.clear,'function');

feedback.show(document,'Added to cart');
assert.equal(toast.textContent,'Added to cart');
assert.equal(toast.visible,true);
assert.equal(window.__toast,1);

feedback.clear(document);
assert.equal(toast.textContent,'');
assert.equal(toast.visible,false);
assert.equal(window.__toast,null);
assert.ok(cleared.includes(1),'clearing a toast must cancel its pending expiry timer');

state.cart=true;
feedback.show(document,'Added 2 to cart');
assert.equal(toast.textContent,'');
assert.equal(toast.visible,false,'added-to-cart messages must not cover the cart screen');

feedback.show(document,'Coupon applied');
assert.equal(toast.textContent,'Coupon applied');
assert.equal(toast.visible,true,'useful non-cart feedback must remain available on the cart screen');

feedback.clear(document);
state.cart=false;
state.checkout=true;
feedback.show(document,'Added to cart');
assert.equal(toast.visible,false,'added-to-cart messages must not cover checkout');

console.log('customer feedback toast lifecycle OK');
