const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/orders-data.js','utf8');

function setup({customerId='cust-1',orders=[{id:'o1'}],api=async()=>({orders:[{id:'o2'}]}),notifications=null,activeView='orders'}={}){
  const calls=[];
  const intervals=[];
  const cleared=[];
  const state={orders};
  let currentCustomerId=customerId;
  const notificationApi=notifications||null;
  if(notificationApi){
    const originalSet=notificationApi.setCustomerId;
    notificationApi.setCustomerId=value=>{currentCustomerId=String(value);originalSet?.(value)};
  }
  const context={
    window:{FreshWayNotifications:notificationApi||undefined},
    document:{querySelector:selector=>{
      if(selector==='#ordersView.active-view')return activeView==='orders'?{id:'ordersView',classList:{contains:()=>true}}:null;
      if(selector==='#ordersView')return {id:'ordersView',classList:{contains:()=>activeView==='orders'}};
      return null;
    }},
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},
    clearInterval:id=>cleared.push(id)
  };
  vm.runInNewContext(source,context);
  const events=[];
  const service=context.window.FreshWayCustomerOrdersData.create({
    api:async(...args)=>{calls.push(args);return api(...args)},
    customerId:()=>currentCustomerId,
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

  const homeOffline=setup({activeView:'home',api:async()=>{throw new Error('offline')},orders:[{id:'saved'}]});
  await homeOffline.service.load();
  assert.equal(homeOffline.events.some(event=>Array.isArray(event)&&event[0]==='toast'),false,'Home must not show order-refresh feedback');
  assert.deepEqual(homeOffline.events,[['orders',[{id:'saved'}]]]);

  const unauthorized=setup({api:async()=>{const error=new Error('Customer authentication required.');error.status=401;throw error},orders:[{id:'saved'}]});
  await unauthorized.service.load();
  assert.deepEqual(unauthorized.events,[['orders',[{id:'saved'}]],['toast','Your sign-in needs refreshing. Sign in again to load current orders.']]);

  let recoveryCalls=0;
  let setCustomerIdCalls=0;
  const recoverable=setup({
    orders:[{id:'saved'}],
    notifications:{
      session:async()=>({customerId:'cust-1'}),
      setCustomerId:()=>{setCustomerIdCalls++}
    },
    api:async()=>{
      recoveryCalls++;
      if(recoveryCalls===1){const error=new Error('Customer identity does not match the signed-in account.');error.status=403;throw error}
      return {orders:[{id:'fresh-after-session-check'}]}
    }
  });
  await recoverable.service.load();
  assert.equal(recoveryCalls,2,'an authentication failure is retried once after a successful session check');
  assert.equal(setCustomerIdCalls,1,'the validated session customer ID is synchronized');
  assert.deepEqual(recoverable.state.orders,[{id:'fresh-after-session-check'}]);
  assert.equal(recoverable.events.filter(event=>Array.isArray(event)&&event[0]==='toast').length,0);

  let changedIdCalls=0;
  const changedId=setup({
    customerId:'stale-id',
    orders:[{id:'previous-account-order'}],
    notifications:{session:async()=>({customerId:'current-id'}),setCustomerId:()=>{}},
    api:async(path)=>{
      changedIdCalls++;
      if(path.includes('stale-id')){const error=new Error('Customer identity does not match the signed-in account.');error.status=403;throw error}
      return {orders:[{id:'current-account-order'}]}
    }
  });
  await changedId.service.load();
  assert.equal(changedIdCalls,2,'stale local identity is replaced and the current account is retried');
  assert.deepEqual(changedId.state.orders,[{id:'current-account-order'}]);


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
