const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('frontend/customer/checkout-submit.js','utf8');
const sandbox={window:{},globalThis:{}};
vm.runInNewContext(source,sandbox);
const create=sandbox.window.FreshWayCustomerCheckoutSubmit.create;
assert.equal(typeof create,'function');

const listeners=[];
const elements={
  '#checkoutForm':{querySelector:()=>({disabled:false,innerHTML:'',textContent:''}),addEventListener:(type,fn)=>listeners.push([type,fn]),reset:()=>{}},
  '#customerName':{value:'Ravi'},
  '#customerPhone':{value:'9876543210'},
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
    clientOrderId:()=>({key:'client-1',fingerprint:'fp'}),
    validate:()=>'',
    payload:(customer,address,items,id,clientOrderId,whatsappOptIn)=>({customer,address,items,id,clientOrderId,whatsappOptIn})
  },
  customerAuth:{ensureAuthenticated:async()=>calls.push('auth')},
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
assert.equal(listeners.length,1);
assert.equal(listeners[0][0],'submit');

(async()=>{
  await service.submitOrder({preventDefault(){},target:elements['#checkoutForm']});
  assert.equal(state.orders[0].id,'order-1');
  assert.deepEqual(state.cart,{});
  assert.equal(state.profile.address,'formatted');
  assert.equal(state.profile.checkout.name,'Ravi');
  assert.equal(state.profile.checkout.phone,'9876543210');
  assert.equal(state.profile.pendingCheckout,undefined);
  assert.ok(calls.includes('auth'));
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='api'&&x[1]==='/api/orders'));
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='notify'));
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='confirmation'&&x[1]==='order-1'));
  assert.ok(calls.includes('products'));
  assert.ok(calls.includes('profile'));
  assert.ok(calls.includes('cartbar'));
  console.log('customer checkout submission tests passed');
})().catch(err=>{console.error(err);process.exitCode=1});
