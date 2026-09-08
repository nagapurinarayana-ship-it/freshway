const assert=require('node:assert/strict');
const vm=require('node:vm');
const calls=[];
const notifications={
  session:()=>calls.push('session'),
  login:()=>calls.push('login'),
  ensureAuthenticated:phone=>{calls.push(['ensure',phone]);return 'ok'},
  logout:()=>calls.push('logout'),
  customerId:()=> 'customer-1'
};
const context={window:{FreshWayNotifications:notifications}};
vm.runInNewContext(require('node:fs').readFileSync('frontend/customer/auth.js','utf8'),context);
const api=context.window.FreshWayCustomerAuth;
assert.equal(typeof api.session,'function');
assert.equal(typeof api.login,'function');
assert.equal(typeof api.ensureAuthenticated,'function');
assert.equal(typeof api.logout,'function');
assert.equal(api.customerId(),'customer-1');
assert.equal(api.ensureAuthenticated('9999999999'),'ok');
api.session();
api.login();
api.logout();
assert.deepEqual(calls,[['ensure','9999999999'],'session','login','logout']);
console.log('customer auth boundary OK');
