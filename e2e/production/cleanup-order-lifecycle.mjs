import fs from 'node:fs';

const baseURL=process.env.FRESHWAY_PRODUCTION_URL||'https://fwcoldpressed.in';
const orderId=process.env.FRESHWAY_TEST_ORDER_ID||'';
const customerId=process.env.FRESHWAY_TEST_CUSTOMER_ID||'';
const adminToken=process.env.ADMIN_TOKEN||'';
const storeId=process.env.FRESHWAY_TEST_STORE_ID||'';
const productId=process.env.FRESHWAY_TEST_PRODUCT_ID||'';
const reservedBefore=Number(process.env.FRESHWAY_TEST_RESERVED_BEFORE);

function writeRunnerEnv(key,value){
  if(!process.env.GITHUB_ENV)throw new Error('GITHUB_ENV is not available for production cleanup.');
  fs.appendFileSync(process.env.GITHUB_ENV,key+'='+String(value)+'\n');
}
async function body(response,label){
  const data=await response.json().catch(()=>({}));
  if(!response.ok())throw new Error(label+' failed with HTTP '+response.status()+': '+JSON.stringify(data));
  return data;
}

if(!customerId&&!orderId){
  console.log('No production test customer or order was created; nothing to clean up.');
}else if(!orderId){
  // The customer was created but checkout never produced an order. The unique
  // run-scoped test customer can be soft-deleted safely by the following D1 step.
  writeRunnerEnv('FRESHWAY_TEST_CLEANUP_VERIFIED','true');
  console.log('No test order exists; isolated test customer is eligible for safe soft deletion.');
}else{
  if(!adminToken)throw new Error('ADMIN_TOKEN is missing; cannot safely cancel the production test order.');
  if(!customerId||!storeId||!productId||!Number.isFinite(reservedBefore))throw new Error('Production cleanup is missing the exact test customer/store/product/reservation identifiers.');
  const login=await fetch(baseURL+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:adminToken})});
  const cookieHeader=login.headers.get('set-cookie')||'';
  const cookie=cookieHeader.split(';',1)[0];
  await body(login,'Owner login for emergency production test cleanup');
  if(!cookie)throw new Error('Owner login did not establish a session cookie for cleanup.');
  const ownerRequest=async(path,options={})=>fetch(baseURL+path,{...options,headers:{cookie,'content-type':'application/json',...(options.headers||{})}});

  // Safe and idempotent: any order created by this run is first marked as a
  // test order and cancelled through the same Owner API used by the real app.
  const patch=await ownerRequest('/api/admin/orders/'+encodeURIComponent(orderId),{
    method:'PATCH',body:JSON.stringify({status:'Cancelled',isTestOrder:true})
  });
  await body(patch,'Cancel and classify the production test order');

  const rowsResponse=await ownerRequest('/api/admin/orders?testOrders=1&limit=10&search='+encodeURIComponent(orderId));
  const rows=await body(rowsResponse,'Verify Owner test-order state');
  const order=(rows.orders||[]).find(item=>item.id===orderId);
  if(!order||order.isTestOrder!==true||order.status!=='Cancelled')throw new Error('Production cleanup could not verify the order is both test-classified and cancelled.');

  const inventoryResponse=await ownerRequest('/api/admin/delivery/stores/'+encodeURIComponent(storeId)+'/inventory');
  const inventory=await body(inventoryResponse,'Verify production store inventory after cleanup');
  const item=(inventory.inventory||[]).find(row=>String(row.id)===String(productId));
  if(!item||Number(item.reserved_qty)!==reservedBefore)throw new Error('Production inventory cleanup did not restore the original reservation count.');
  writeRunnerEnv('FRESHWAY_TEST_CLEANUP_VERIFIED','true');
  console.log('Production test order is cancelled and test-classified; the store reservation count is back to its pre-test value.');
}
