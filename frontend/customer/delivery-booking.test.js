const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const data=new Map();
const context={window:{localStorage:{
  getItem:key=>data.has(key)?data.get(key):null,
  setItem:(key,value)=>data.set(key,String(value)),
  removeItem:key=>data.delete(key)
}},Intl,Date};
vm.createContext(context);
vm.runInNewContext(fs.readFileSync('frontend/customer/delivery-booking.js','utf8'),context);
const create=context.window.FreshWayCustomerDeliveryBooking?.create;
assert.equal(typeof create,'function','delivery picker module must expose its booking factory');
const makeContainer=()=>{
 const listeners={};
 return {dataset:{},classList:{add(){}},hidden:true,innerHTML:'',
  addEventListener:(name,handler)=>{listeners[name]=handler},
  replaceChildren(){this.innerHTML=''},
  fireDateChoice(choice){
   const node={dataset:{fwDateChoice:choice}};
   listeners.click({target:{closest:selector=>selector==='[data-fw-date-choice]'?node:null}});
  }
 };
};
const key='freshway-checkout-delivery-date-v1';
const first=makeContainer(),booking=create({});
booking.mountCheckout(first);
const today=first.__fwDeliveryDateState.date;
first.fireDateChoice('tomorrow');
const tomorrow=first.__fwDeliveryDateState.date;
assert.notEqual(tomorrow,today,'Tomorrow selection must differ from Today');
assert.equal(data.get(key),tomorrow,'selected delivery day must be persisted immediately');
const afterReload=makeContainer(),reloadedBooking=create({});
reloadedBooking.mountCheckout(afterReload);
assert.equal(afterReload.__fwDeliveryDateState.date,tomorrow,'recreating checkout must restore the selected date');
assert.equal(reloadedBooking.selectedCheckoutDate(),tomorrow,'checkout must use the restored date');
reloadedBooking.clearCheckoutDate();
assert.equal(data.has(key),false,'successful order completion clears the remembered date');
assert.equal(reloadedBooking.selectedCheckoutDate(),today,'the next order starts with Today');
console.log('customer checkout delivery-day persistence tests passed');

(async()=>{
  let shouldFail=false;
  const calls=[];
  const container=makeContainer();
  const booking=create({
    api:async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});
      if(shouldFail)throw new Error('temporary network failure');
      return {available:true,code:'AVAILABLE',message:'Good news! We deliver to your area.'};
    },
    getItems:()=>[{id:'rice-1',qty:2}],
    getAddress:()=>({latitude:17.385,longitude:78.4867})
  });
  booking.mountCheckout(container);
  const available=await booking.checkAvailability();
  assert.equal(available.status,'available');
  assert.ok(calls.length>=1);
  assert.equal(calls.at(-1).url,'/api/delivery/availability');
  assert.deepEqual(calls.at(-1).body.address,{latitude:17.385,longitude:78.4867});
  assert.match(container.innerHTML,/Good news! We deliver to your area\./);

  shouldFail=true;
  const failed=await booking.checkAvailability();
  assert.equal(failed.status,'error','technical failures must not be misreported as an area restriction');
  assert.match(container.innerHTML,/We could not check delivery availability/);
  console.log('customer store-availability UI states passed');
})().catch(error=>{console.error(error);process.exitCode=1});
