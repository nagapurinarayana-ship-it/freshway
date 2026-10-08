const assert=require('node:assert/strict');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(require('node:fs').readFileSync('frontend/customer/orders-view.js','utf8'),context);
const api=context.window.FreshWayCustomerOrdersView;
assert.equal(typeof api.render,'function');
const el={innerHTML:''};
const document={querySelector(){return el}};
api.render(document,[],{esc:String,formatDate:String,money:n=>`₹${n}`,statusLabel:String,planText:String});
assert.match(el.innerHTML,/No orders yet/);
api.render(document,[{id:'FW-1',status:'New',createdAt:'2026-09-08',items:[{name:'Apple',qty:2,unit:'kg',price:120,lineTotal:240}],total:240,address:{house:'1',area:'A',city:'C',pincode:'123456'},deliveryPlan:'Today',payment:'Pending'}],{esc:String,formatDate:String,money:n=>`₹${n}`,statusLabel:String,planText:String});
assert.match(el.innerHTML,/FW-1/);
assert.match(el.innerHTML,/Apple/);
assert.match(el.innerHTML,/₹240/);

const delivered={id:'FW-2',status:'Delivered',createdAt:'2026-09-08',items:[],total:240,address:{house:'1',area:'A',city:'C',pincode:'123456'},deliveryPlan:'Tomorrow',payment:'Collected'};
api.render(document,[delivered],{esc:String,formatDate:String,money:n=>`₹${n}`,statusLabel:String,planText:String});
assert.match(el.innerHTML,/🚚 Delivery/);
assert.match(el.innerHTML,/Delivered/);
assert.doesNotMatch(el.innerHTML,/Tomorrow/);

console.log('customer orders-view helpers OK');
