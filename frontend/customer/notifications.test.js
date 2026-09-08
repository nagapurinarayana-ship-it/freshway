const assert=require('node:assert/strict');
const vm=require('node:vm');
const calls=[];
const notifications={
  enable:()=>{calls.push('enable');return Promise.resolve(true)},
  registerCustomer:(name,phone,optIn)=>{calls.push([name,phone,optIn]);return Promise.resolve(true)}
};
const context={window:{FreshWayNotifications:notifications}};
vm.runInNewContext(require('node:fs').readFileSync('frontend/customer/notifications.js','utf8'),context);
const api=context.window.FreshWayCustomerNotifications;
assert.equal(typeof api.enable,'function');
assert.equal(typeof api.registerCustomer,'function');
api.enable();
api.registerCustomer('Test Customer','9999999999',true);
assert.deepEqual(calls,['enable',['Test Customer','9999999999',true]]);
console.log('customer notification boundary OK');
