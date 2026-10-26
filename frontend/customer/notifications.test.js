const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const calls=[];
const notifications={
  enable:()=>{calls.push('enable');return Promise.resolve(true)},
  getStatus:()=>{calls.push('status');return Promise.resolve({state:'enabled',permission:'granted',label:'Order updates are enabled on this device'})},
  registerCustomer:(name,phone,optIn)=>{calls.push([name,phone,optIn]);return Promise.resolve(true)}
};
const context={window:{FreshWayNotifications:notifications}};
vm.runInNewContext(fs.readFileSync('frontend/customer/notifications.js','utf8'),context);
const api=context.window.FreshWayCustomerNotifications;
assert.equal(typeof api.enable,'function');
assert.equal(typeof api.getStatus,'function');
assert.equal(typeof api.registerCustomer,'function');
api.enable();
api.getStatus();
api.registerCustomer('Test Customer','9999999999',true);
assert.deepEqual(calls,['enable','status',['Test Customer','9999999999',true]]);
const accountActions=fs.readFileSync('frontend/customer/account-actions.js','utf8');
assert.match(accountActions,/showNotificationPermissionHelp/);
assert.match(accountActions,/Android Settings/);
assert.match(accountActions,/Chrome/);
assert.match(accountActions,/visibilitychange/);
assert.match(accountActions,/dataset\.permissionState/);
console.log('customer notification boundary and permission-recovery contracts OK');
