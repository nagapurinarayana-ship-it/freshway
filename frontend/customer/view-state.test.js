const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('node:fs').readFileSync('frontend/customer/view-state.js','utf8');
const stored={value:'orders'};
const storage={getItem:key=>key==='freshway-current-view-v1'?stored.value:null,setItem:(key,value)=>{if(key==='freshway-current-view-v1')stored.value=value}};
const context={window:{},sessionStorage:storage};
vm.runInNewContext(source,context);
const api=context.window.FreshWayCustomerViewState;
assert.equal(api.KEY,'freshway-current-view-v1');
assert.equal(api.clickedView({closest:s=>s==='[data-nav]'?{dataset:{nav:'orders'}}:null}),'orders');
assert.equal(api.clickedView({closest:s=>s==='.back-btn'?{dataset:{back:'home'}}:null}),'home');
assert.equal(api.clickedView({closest:s=>s==='#viewCartBtn'?{}:null}),'cart');
assert.equal(api.clickedView({closest(){return null}}),null);
api.saveView('messages');
assert.equal(stored.value,'messages');
assert.equal(stored.value,'messages');

const removed=[];
const calls=[];
const restoreWindow={
  history:{state:{__freshwayCustomer:true,view:'cart'}},
  location:{hash:'#orders'},
  setView:(name,options)=>calls.push({name,options}),
  state:{orders:[]}
};
const restoreDocument={documentElement:{classList:{remove:name=>removed.push(name)}}};
assert.equal(api.restore({document:restoreDocument,window:restoreWindow}),true);
assert.deepEqual(calls,[{name:'cart',options:{history:'replace'}}],
  'the current browser-history entry must win over stale sessionStorage and URL hash values');
assert.equal(stored.value,'cart');
assert.deepEqual(removed,['fw-view-restore-pending']);
assert.match(source,/window\.addEventListener\('popstate'/,'Back/Forward should keep the saved route aligned with browser history');
console.log('customer view-state helpers and deterministic refresh restoration OK');
