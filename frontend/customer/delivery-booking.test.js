const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const data=new Map();
let openedView='';
const context={window:{setView:name=>{openedView=name},localStorage:{
  getItem:key=>data.has(key)?data.get(key):null,
  setItem:(key,value)=>data.set(key,String(value)),
  removeItem:key=>data.delete(key)
}},Intl,Date,setTimeout,clearTimeout};
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
  },
  fireContact(){
   const node={dataset:{fwDeliveryContact:''}};
   listeners.click({target:{closest:selector=>selector==='[data-fw-delivery-contact]'?node:null}});
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
  const bookingAddress={latitude:17.385,longitude:78.4867};
  const container=makeContainer();
  const booking=create({
    api:async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});
      if(shouldFail)throw new Error('temporary network failure');
      return {available:true,code:'AVAILABLE',message:'Good news! We deliver to your area.'};
    },
    getItems:()=>[{id:'rice-1',qty:2}],
    getAddress:()=>bookingAddress
  });
  booking.mountCheckout(container);
  const available=await booking.checkAvailability();
  assert.equal(available.status,'available');
  assert.ok(calls.length>=1);
  assert.equal(calls.at(-1).url,'/api/delivery/availability');
  assert.deepEqual(calls.at(-1).body.address,{latitude:17.385,longitude:78.4867});
  assert.match(container.innerHTML,/Good news! We deliver to your area\./);

  shouldFail=true;
  bookingAddress.longitude=78.5;
  const failed=await booking.checkAvailability();
  assert.equal(failed.status,'error','technical failures must not be misreported as an area restriction');
  assert.match(container.innerHTML,/We could not check delivery availability/);

  let burstAddress={latitude:17.385,longitude:78.4867};
  const burstCalls=[];
  const burstContainer=makeContainer();
  const burstBooking=create({
    api:async(url,request)=>{burstCalls.push({url,body:JSON.parse(request.body)});return {available:true,code:'AVAILABLE',message:'Available'};},
    getItems:()=>[{id:'rice-1',qty:2}],
    getAddress:()=>burstAddress
  });
  burstBooking.mountCheckout(burstContainer);
  await burstBooking.checkAvailability();
  assert.equal(burstCalls.length,1,'mount and explicit checkout check must share one request');
  await Promise.all(Array.from({length:17},()=>burstBooking.refreshCheckout()));
  assert.equal(burstCalls.length,1,'checkout change bursts reuse the same availability result');
  burstAddress={latitude:17.385,longitude:78.5};
  await Promise.all(Array.from({length:17},()=>burstBooking.refreshCheckout()));
  assert.equal(burstCalls.length,2,'a changed map pin triggers exactly one new availability request');
  assert.equal(burstCalls[1].body.address.longitude,78.5);
  const areaContainer=makeContainer();
  const areaBooking=create({
    api:async()=>({available:false,code:'AREA_UNAVAILABLE',message:'Sorry, we do not deliver to this address yet.'}),
    getItems:()=>[{id:'rice-1',qty:2}],
    getAddress:()=>({latitude:17.385,longitude:78.4867})
  });
  areaBooking.mountCheckout(areaContainer);
  const unavailableArea=await areaBooking.checkAvailability();
  assert.equal(unavailableArea.code,'AREA_UNAVAILABLE');
  assert.match(areaContainer.innerHTML,/Outside our current delivery area\?/);
  assert.match(areaContainer.innerHTML,/nearby RTC bus stand/);
  assert.match(areaContainer.innerHTML,/postal delivery/);
  assert.match(areaContainer.innerHTML,/data-fw-delivery-contact/);
  areaContainer.fireContact();
  assert.equal(openedView,'contact','Contact FreshWay opens the existing Contact Us page');

  const stockContainer=makeContainer();
  const stockBooking=create({
    api:async()=>({available:false,code:'OUT_OF_STOCK',message:'Some items are unavailable.'}),
    getItems:()=>[{id:'rice-1',qty:2}],
    getAddress:()=>({latitude:17.385,longitude:78.4867})
  });
  stockBooking.mountCheckout(stockContainer);
  await stockBooking.checkAvailability();
  assert.doesNotMatch(stockContainer.innerHTML,/data-fw-delivery-contact/,'stock issues must not show an out-of-area delivery promise');

  console.log('customer store-availability UI states, area-contact help and request coalescing passed');
})().catch(error=>{console.error(error);process.exitCode=1});
