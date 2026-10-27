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
  assert.deepEqual(offline.events,[['orders',[{id:'saved'}]],['toast','Could not refresh orders. Showing saved details; try again shortly.']]);

  const unauthorized=setup({api:async()=>{const error=new Error('Customer authentication required.');error.status=401;throw error},orders:[{id:'saved'}]});
  await unauthorized.service.load();
  assert.deepEqual(unauthorized.events,[['orders',[{id:'saved'}]],['toast','Your sign-in needs refreshing. Sign in again to load current orders.']]);

  let resolveOrders;
  let calls=0;
  const concurrent=setup({orders:[{id:'saved'}],api:()=>{calls++;return new Promise(resolve=>{resolveOrders=resolve})}});
  const first=concurrent.service.load();
  const second=concurrent.service.load({silentError:true});
  await Promise.resolve();
  assert.equal(calls,1,'overlapping lifecycle and mutation refreshes must share one API request');
  resolveOrders({orders:[{id:'fresh'}]});
  await Promise.all([first,second]);
  assert.deepEqual(concurrent.state.orders,[{id:'fresh'}]);
  assert.equal(concurrent.events.filter(event=>Array.isArray(event)&&event[0]==='toast').length,0,'silent mutation refresh must not emit a duplicate stale-data toast');

  const guest=setup({customerId:null});
  await guest.service.load();
  assert.equal(guest.calls.length,0);
  assert.equal(guest.state.orders.length,0);
  assert.equal(guest.events[0],'save');
  assert.equal(guest.events[1][0],'orders');
  assert.equal(guest.events[1][1].length,0);
  assert.equal(guest.events[2],'profile');

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
