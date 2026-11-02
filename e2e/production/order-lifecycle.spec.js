import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl=process.env.FRESHWAY_PRODUCTION_URL||'https://fwcoldpressed.in';
const storeId=process.env.FRESHWAY_TEST_STORE_ID;
const latitude=Number(process.env.FRESHWAY_TEST_LATITUDE);
const longitude=Number(process.env.FRESHWAY_TEST_LONGITUDE);
const productId=process.env.FRESHWAY_TEST_PRODUCT_ID;
const categoryId=process.env.FRESHWAY_TEST_CATEGORY_ID;
const phone=process.env.FRESHWAY_TEST_PHONE;
const adminToken=process.env.ADMIN_TOKEN;

function writeRunnerEnv(values){
  const target=process.env.GITHUB_ENV;
  if(!target)throw new Error('This production lifecycle test must run from its isolated GitHub Actions workflow.');
  for(const [key,value] of Object.entries(values)){
    if(value===undefined||value===null||/[\r\n]/.test(String(value)))throw new Error('Invalid workflow test state: '+key);
    fs.appendFileSync(target,key+'='+String(value)+'\n');
  }
}
function localDate(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const values={};for(const part of parts)values[part.type]=part.value;
  return values.year+'-'+values.month+'-'+values.day;
}
async function json(response,label){
  const body=await response.json().catch(()=>({}));
  expect(response.ok(),label+' returned HTTP '+response.status()+': '+JSON.stringify(body)).toBe(true);
  return body;
}
function inventoryItem(data){
  return (data.inventory||[]).find(item=>String(item.id)===String(productId));
}

test('real production customer order is assigned, reserved, cancelled by Owner approval, and stock is restored',async({request})=>{
  test.setTimeout(180000);
  expect(adminToken,'ADMIN_TOKEN must exist as a GitHub Actions production environment secret').toBeTruthy();
  expect(storeId).toBeTruthy();
  expect(Number.isFinite(latitude)&&Number.isFinite(longitude)).toBe(true);
  expect(productId).toBeTruthy();
  expect(categoryId).toBeTruthy();
  expect(phone).toMatch(/^0\d{9}$/);

  // Authenticate Owner before creating any production customer/test data.
  const ownerLogin=await request.post('/api/admin/login',{data:{token:adminToken}});
  expect(ownerLogin.status(),'Owner authentication must work before any writes').toBe(200);

  const inventoryBeforeResponse=await request.get('/api/admin/delivery/stores/'+encodeURIComponent(storeId)+'/inventory');
  const inventoryBefore=await json(inventoryBeforeResponse,'Owner inventory read before test');
  const beforeItem=inventoryItem(inventoryBefore);
  expect(beforeItem,'selected product must exist in the chosen active store').toBeTruthy();
  const beforeOnHand=Number(beforeItem.on_hand);
  const beforeReserved=Number(beforeItem.reserved_qty);
  expect(Number.isFinite(beforeOnHand)&&Number.isFinite(beforeReserved)).toBe(true);
  expect(beforeOnHand-beforeReserved,'fixture must have exactly one available unit').toBe(1);
  writeRunnerEnv({FRESHWAY_TEST_RESERVED_BEFORE:beforeReserved});

  const runId=process.env.GITHUB_RUN_ID||String(Date.now());
  const customerName='FRESHWAY AUTOMATED TEST '+runId;
  const passcode=String(BigInt(runId.slice(-8)||'1')%1000000n).padStart(6,'0');
  const registration=await request.post('/api/auth/register',{data:{name:customerName,phone,passcode,whatsappOptIn:false}});
  const account=await json(registration,'Create isolated production test customer');
  expect(account.customerId).toBeTruthy();
  writeRunnerEnv({
    FRESHWAY_TEST_CUSTOMER_ID:account.customerId,
    FRESHWAY_TEST_CUSTOMER_NAME:customerName
  });

  const customerSession=await request.get('/api/auth/session');
  const session=await json(customerSession,'Verify newly registered customer session');
  expect(session.customerId).toBe(account.customerId);

  const quoteResponse=await request.post('/api/checkout/quote',{data:{items:[{id:productId,qty:1}],couponCode:''}});
  const quote=await json(quoteResponse,'Get live production checkout quote');
  const expectedTotal=Number(quote.pricing?.finalTotal);
  expect(Number.isSafeInteger(expectedTotal)&&expectedTotal>=0,'production quote must provide an integer final total').toBe(true);

  const address={
    house:'E2E-'+runId,
    area:'FreshWay automated lifecycle test',
    city:'Mancherial',
    pincode:'504208',
    landmark:'Automated test only — do not dispatch',
    note:'Production integration test. Owner approval will cancel this order; no delivery or payment is requested.',
    latitude,
    longitude,
    locationSource:'automated_test',
    deliveryPhone:phone
  };
  const clientOrderId=('FW_E2E_'+runId+'_'+(process.env.GITHUB_RUN_ATTEMPT||'1')).slice(0,100);
  const orderResponse=await request.post('/api/orders',{data:{
    customerId:account.customerId,
    customer:{name:customerName,phone},
    address,
    items:[{id:productId,qty:1}],
    preferredDeliveryDate:localDate(),
    expectedTotal,
    clientOrderId,
    whatsappOptIn:false
  }});
  const order=await json(orderResponse,'Place one real production test order through the customer API');
  expect(order.id).toMatch(/^FW-[A-Za-z0-9-]+$/);
  writeRunnerEnv({FRESHWAY_TEST_ORDER_ID:order.id});

  // Customer must see the placed order and the API response must show the same
  // store that the live availability engine selected.
  expect(order.assignedStoreId).toBe(storeId);
  const liveAvailabilityResponse=await request.post('/api/delivery/availability',{data:{address,items:[{id:productId,qty:1}]}});
  const liveAvailability=await json(liveAvailabilityResponse,'Check store availability after checkout');
  expect(liveAvailability.available).toBe(false);
  expect(liveAvailability.code).toBe('OUT_OF_STOCK');

  const customerOrdersResponse=await request.get('/api/orders?customerId='+encodeURIComponent(account.customerId));
  const customerOrders=await json(customerOrdersResponse,'Read the new order from the customer account');
  expect((customerOrders.orders||[]).some(item=>item.id===order.id)).toBe(true);

  const ownerOrdersResponse=await request.get('/api/admin/orders?limit=10&search='+encodeURIComponent(order.id));
  const ownerOrders=await json(ownerOrdersResponse,'Find the real order in Owner live orders');
  const liveOrder=(ownerOrders.orders||[]).find(item=>item.id===order.id);
  expect(liveOrder,'Owner live order list must contain this order').toBeTruthy();
  expect(liveOrder.isTestOrder).toBe(false);
  expect(liveOrder.scheduledDelivery?.storeId).toBe(storeId);

  const inventoryReservedResponse=await request.get('/api/admin/delivery/stores/'+encodeURIComponent(storeId)+'/inventory');
  const inventoryReserved=await json(inventoryReservedResponse,'Read store inventory after order reservation');
  const reservedItem=inventoryItem(inventoryReserved);
  expect(Number(reservedItem?.reserved_qty)).toBe(beforeReserved+1);
  expect(Number(reservedItem?.on_hand)).toBe(beforeOnHand);

  // Use the same customer request route as the app. A cancellation request is
  // reviewed by Owner, unlike a direct cancel during the initial New state.
  const customerCancelResponse=await request.post('/api/orders/'+encodeURIComponent(order.id)+'/request',{
    data:{requestType:'cancellation',reason:'Automated production test — verify Owner cancellation and reservation release.'}
  });
  expect(customerCancelResponse.status()).toBe(202);
  const cancellation=await customerCancelResponse.json();
  expect(cancellation.ok).toBe(true);
  expect(cancellation.request?.status).toBe('pending');
  const requestId=cancellation.request?.requestId;
  expect(requestId).toBeTruthy();

  const ownerRequestsResponse=await request.get('/api/admin/delivery/requests');
  const ownerRequests=await json(ownerRequestsResponse,'Read Owner pending customer requests');
  const pending=(ownerRequests.requests||[]).find(item=>item.id===requestId&&item.order_id===order.id);
  expect(pending,'Owner request queue must contain the customer cancellation request').toBeTruthy();
  expect(pending.request_type).toBe('cancellation');

  // Move the order into the dedicated Owner test-orders list before approval.
  // The cancellation handler suppresses further customer/Owner push alerts for
  // classified test orders.
  const classifyResponse=await request.patch('/api/admin/orders/'+encodeURIComponent(order.id),{data:{isTestOrder:true}});
  const classified=await json(classifyResponse,'Classify the integration order as a test order');
  expect(classified.isTestOrder).toBe(true);

  const ownerTestOrdersResponse=await request.get('/api/admin/orders?testOrders=1&limit=10&search='+encodeURIComponent(order.id));
  const ownerTestOrders=await json(ownerTestOrdersResponse,'Find the order in the Owner test-orders list');
  const testOrder=(ownerTestOrders.orders||[]).find(item=>item.id===order.id);
  expect(testOrder?.isTestOrder).toBe(true);

  const hiddenCustomerOrdersResponse=await request.get('/api/orders?customerId='+encodeURIComponent(account.customerId));
  const hiddenCustomerOrders=await json(hiddenCustomerOrdersResponse,'Ensure test orders are excluded from customer order history');
  expect((hiddenCustomerOrders.orders||[]).some(item=>item.id===order.id)).toBe(false);

  const approvalResponse=await request.patch('/api/admin/delivery/requests/'+encodeURIComponent(requestId),{
    data:{decision:'approve',note:'Approved by automated production lifecycle test; verify cancellation and stock release.'}
  });
  const approval=await json(approvalResponse,'Owner approves the customer cancellation request');
  expect(approval.status).toBe('approved');
  expect(approval.orderStatus).toBe('Cancelled');

  const finalOwnerOrdersResponse=await request.get('/api/admin/orders?testOrders=1&limit=10&search='+encodeURIComponent(order.id));
  const finalOwnerOrders=await json(finalOwnerOrdersResponse,'Verify cancelled test order in Owner test-orders list');
  const finalOrder=(finalOwnerOrders.orders||[]).find(item=>item.id===order.id);
  expect(finalOrder?.isTestOrder).toBe(true);
  expect(finalOrder?.status).toBe('Cancelled');

  const inventoryAfterResponse=await request.get('/api/admin/delivery/stores/'+encodeURIComponent(storeId)+'/inventory');
  const inventoryAfter=await json(inventoryAfterResponse,'Read store inventory after Owner cancellation');
  const afterItem=inventoryItem(inventoryAfter);
  expect(Number(afterItem?.on_hand)).toBe(beforeOnHand);
  expect(Number(afterItem?.reserved_qty)).toBe(beforeReserved);

  const availabilityAfterResponse=await request.post('/api/delivery/availability',{data:{address,items:[{id:productId,qty:1}]}});
  const availabilityAfter=await json(availabilityAfterResponse,'Confirm inventory is available again after cancellation');
  expect(availabilityAfter.available).toBe(true);
  expect(availabilityAfter.store?.id).toBe(storeId);

  const historyResponse=await request.get('/api/admin/delivery/orders/'+encodeURIComponent(order.id)+'/history');
  const history=await json(historyResponse,'Verify Owner audit history for the lifecycle');
  const actions=(history.events||[]).map(event=>event.action);
  expect(actions).toContain('cancellation_requested');
  expect(actions).toContain('order_request_approved');
  expect(actions).toContain('order_status_changed');
});
