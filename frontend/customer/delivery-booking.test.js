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
