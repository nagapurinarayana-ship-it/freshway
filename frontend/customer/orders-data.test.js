const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/orders-data.js','utf8');

function setup({customerId='cust-1',orders=[{id:'o1'}],api=async()=>({orders:[{id:'o2'}]})}={}){
  const calls=[];
  const intervals=[];
  const cleared=[];
  const state={orders};
  const context={
    window:{},
    document:{querySelector:()=>({classList:{contains:()=>true}})},
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},
    clearInterval:id=>cleared.push(id)
  };
  vm.runInNewContext(source,context);
  const events=[];
  const service=context.window.FreshWayCustomerOrdersData.create({
    api:async(...args)=>{calls.push(args);return api(...args)},
    customerId:()=>customerId,
    readState:()=>state,
    save:()=>events.push('save'),
    renderOrders:list=>events.push(['orders',list]),
    renderProfile:()=>events.push('profile'),
    toast:msg=>events.push(['toast',msg]),
    document:context.document
  });
  return {service,state,calls,events,intervals,cleared};
}

(async()=>{
  const x=setup();
  await x.service.load();
  assert.equal(x.calls[0][0],'/api/orders?customerId=cust-1');
  assert.deepEqual(x.state.orders,[{id:'o2'}]);
  assert.deepEqual(x.events,[ 'save', ['orders',[{id:'o2'}]], 'profile' ]);

  const offline=setup({api:async()=>{throw new Error('offline')},orders:[{id:'saved'}]});
  await offline.service.load();
  assert.deepEqual(offline.events,[['orders',[{id:'saved'}]],['toast','Showing saved orders from this device.']]);

  const guest=setup({customerId:null});
  await guest.service.load();
  assert.equal(guest.calls.length,0);
  assert.deepEqual(guest.events,[['orders',[{id:'o1'}]]]);

  const timer=setup();
  timer.service.start();
  assert.equal(timer.intervals.length,1);
  assert.equal(timer.intervals[0].ms,30000);
  timer.service.start();
  assert.deepEqual(timer.cleared,[1]);
  timer.service.stop();
  assert.deepEqual(timer.cleared,[1,2]);
  console.log('customer order data tests passed');
})();
