const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('frontend/customer/checkout-submit.js','utf8');
const sandbox={window:{FreshWayAddressSystem:{getSelectedAddress:()=>({recipientName:'Saved Recipient',deliveryPhone:'+91 9876543210',houseFlat:'1',area:'Main',city:'Warangal',pincode:'506001',latitude:17.6082,longitude:79.1091,accuracyMeters:18,locationSource:'Map pin',isDefault:true})}},globalThis:{}};
vm.runInNewContext(source,sandbox);
const create=sandbox.window.FreshWayCustomerCheckoutSubmit.create;
assert.equal(typeof create,'function');

const listeners=[];
const elements={
  '#checkoutForm':{noValidate:false,querySelector:()=>({disabled:false,innerHTML:'',textContent:''}),addEventListener:(type,fn)=>listeners.push([type,fn]),reset:()=>{}},
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
  api:async(path,options)=>{calls.push(['api',path,JSON.parse(options.body)]);return {id:'order-1',items:[{name:'Apple',unit:'kg',qty:1,price:120,lineTotal:120}],total:120,payment:'Cash',status:'New',deliveryPlan:'Standard',createdAt:'now',updatedAt:'now'}},
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
  assert.equal(state.profile.address,'formatted');
  assert.equal(state.profile.checkout.name,'Saved Recipient');
  assert.equal(state.profile.checkout.phone,'9876543210','a valid saved delivery number must beat an invalid stale hidden input');
  assert.equal(state.profile.pendingCheckout,undefined);
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='auth'&&x[1]==='9876543210'),'checkout must pass the normalized selected delivery phone to authentication');
  const orderCall=calls.find(x=>Array.isArray(x)&&x[0]==='api'&&x[1]==='/api/orders');
  assert.ok(orderCall,'checkout must call the order API');
  assert.equal(orderCall[2].address.latitude,17.6082,'saved delivery coordinates must reach the server');
  assert.equal(orderCall[2].address.longitude,79.1091,'saved delivery coordinates must reach the server');
  assert.equal(orderCall[2].address.accuracyMeters,18,'saved location accuracy must reach the server');

  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='notify'));
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='confirmation'&&x[1]==='order-1'));
  assert.ok(calls.includes('products'));
  assert.ok(calls.includes('profile'));
  assert.ok(calls.includes('cartbar'));
  console.log('customer checkout submission tests passed');
})().catch(err=>{console.error(err);process.exitCode=1});
