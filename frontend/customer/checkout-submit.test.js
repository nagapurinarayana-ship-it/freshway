const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('frontend/customer/checkout-submit.js','utf8');
const sandbox={window:{FreshWayAddressSystem:{getSelectedAddress:()=>({recipientName:'Saved Recipient',deliveryPhone:'+91 9876543210',houseFlat:'1',area:'Main',city:'Warangal',pincode:'506001',isDefault:true})}},globalThis:{}};
vm.runInNewContext(source,sandbox);
const create=sandbox.window.FreshWayCustomerCheckoutSubmit.create;
assert.equal(typeof create,'function');

const listeners=[];
let failOrderCreation=false;
const submitButton={disabled:false,innerHTML:'',textContent:''};
const elements={
  '#checkoutForm':{noValidate:false,querySelector:()=>submitButton,addEventListener:(type,fn)=>listeners.push([type,fn]),reset:()=>{}},
  '#customerName':{value:'Ravi'},
  '#customerPhone':{value:'stale-invalid-phone'},
  '#whatsappOptIn':{checked:true}
};
const document={querySelector:selector=>elements[selector]||null};
const state={cart:{apple:1},orders:[],profile:{}};
const calls=[];
const deps={
  document,
  cartItems:()=>[{product:{id:'apple'},qty:1,lineTotal:120}],
  state,
  save:()=>calls.push('save'),
  customerAddress:{normalize:value=>value,format:value=>'formatted'},
  customerAddressFlow:{read:()=>({house:'1',area:'Main',city:'Warangal',pincode:'506001'})},
  customerCheckout:{
    normalizePhone:value=>{const digits=String(value||'').replace(/\D/g,'');return digits.length===10?digits:digits.length===12&&digits.startsWith('91')?digits.slice(2):String(value||'').trim()},
    clientOrderId:()=>({key:'client-1',fingerprint:'fp'}),
    validate:()=>'',
    payload:(customer,address,items,id,clientOrderId,whatsappOptIn)=>({customer,address,items,id,clientOrderId,whatsappOptIn})
  },
  customerAuth:{ensureAuthenticated:async(phone)=>calls.push(['auth',phone])},
  customerId:()=> 'customer-1',
  api:async(path,options)=>{calls.push(['api',path,JSON.parse(options.body)]);if(path==='/api/checkout/quote')return {pricing:{itemsSubtotal:120,freeDeliveryEnabled:true,freeDeliveryThreshold:800,qualifiesForFreeDelivery:false,amountToFreeDelivery:680,standardDeliveryFee:30,deliveryFee:30,couponDiscount:0,finalTotal:150,coupon:null,items:[{id:'apple',name:'Apple',unit:'kg',qty:1,price:120,lineTotal:120}]}};if(path==='/api/orders'&&failOrderCreation)throw new Error('Simulated order endpoint failure');return {id:'order-1',items:[{name:'Apple',unit:'kg',qty:1,price:120,lineTotal:120}],total:150,itemsSubtotal:120,deliveryFee:30,couponDiscount:0,payment:'Cash',status:'New',deliveryPlan:'Standard',createdAt:'now',updatedAt:'now'}},
  customerNotifications:{registerCustomer:async(...args)=>calls.push(['notify',...args])},
  toast:message=>calls.push(['toast',message]),
  renderProducts:()=>calls.push('products'),
  renderProfile:()=>calls.push('profile'),
  showConfirmation:order=>calls.push(['confirmation',order.id]),
  updateCartBar:()=>calls.push('cartbar'),
  setView:view=>calls.push(['view',view]),
  money:value=>'₹'+value
};
const service=create(deps);
service.bind();
assert.equal(elements['#checkoutForm'].noValidate,true,'hidden required fields must not silently block checkout submission');
assert.equal(listeners.length,1);
assert.equal(listeners[0][0],'submit');

(async()=>{
  await service.submitOrder({preventDefault(){},target:elements['#checkoutForm']});
  assert.equal(state.orders[0].id,'order-1');
  assert.equal(JSON.stringify(state.cart),'{}');
  assert.equal(JSON.stringify(state.cartProducts),'{}','order completion clears saved cart metadata');
  assert.equal(state.profile.address,'formatted');
  assert.equal(state.profile.checkout.name,'Saved Recipient');
  assert.equal(state.profile.checkout.phone,'9876543210','a valid saved delivery number must beat an invalid stale hidden input');
  assert.equal(state.profile.pendingCheckout,undefined);
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='auth'&&x[1]==='9876543210'),'checkout must pass the normalized selected delivery phone to authentication');
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='api'&&x[1]==='/api/orders'));
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='notify'));
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='confirmation'&&x[1]==='order-1'));
  assert.ok(calls.includes('products'));
  assert.ok(calls.includes('profile'));
  assert.ok(calls.includes('cartbar'));

  // If the customer declines a changed-total prompt, the updated total is now
  // the displayed baseline. Retrying should not repeat the same prompt.
  let displayedTotal=120;
  let confirmationCount=0;
  sandbox.window.FreshWayCustomerDeliveryOffers={
    getAppliedCode:()=> 'SAVE10',
    getDisplayedTotal:()=>displayedTotal,
    renderCheckoutQuote:pricing=>{displayedTotal=Number(pricing.finalTotal);}
  };
  sandbox.window.confirm=()=>{confirmationCount++;return false;};
  state.cart={apple:1};
  state.orders=[];
  state.profile={};
  await service.submitOrder({preventDefault(){},target:elements['#checkoutForm']});
  assert.equal(state.orders.length,0,'declining the total-change prompt must not place the order');
  assert.equal(displayedTotal,150,'the revised total must remain visible for review');
  assert.equal(confirmationCount,1,'the first changed total should require one confirmation');
  await service.submitOrder({preventDefault(){},target:elements['#checkoutForm']});
  assert.equal(state.orders.length,1,'retrying after reviewing the revised total should place the order');
  assert.equal(confirmationCount,1,'the same total-change prompt must not repeat once that total is displayed');

  // A failed order submission must keep the server-quoted payable total on the retry button,
  // not fall back to the item subtotal and hide delivery/coupon adjustments.
  failOrderCreation=true;
  displayedTotal=120;
  state.cart={apple:1};
  state.orders=[];
  state.profile={};
  sandbox.window.confirm=()=>true;
  await service.submitOrder({preventDefault(){},target:elements['#checkoutForm']});
  assert.match(submitButton.innerHTML,/Place order · <span id="checkoutTotal">₹150<\/span>/,
    'failed checkout retry must show the quoted payable total, including delivery and discounts');
  console.log('customer checkout submission tests passed');
})().catch(err=>{console.error(err);process.exitCode=1});
