import { test, expect } from '@playwright/test';

const storeId=process.env.FRESHWAY_TEST_STORE_ID;
const storeName=process.env.FRESHWAY_TEST_STORE_NAME;
const latitude=Number(process.env.FRESHWAY_TEST_LATITUDE);
const longitude=Number(process.env.FRESHWAY_TEST_LONGITUDE);
const productId=process.env.FRESHWAY_TEST_PRODUCT_ID;
const categoryId=process.env.FRESHWAY_TEST_CATEGORY_ID;
const multiBasketReady=process.env.FRESHWAY_TEST_MULTI_BASKET_READY==='true';
const multiBasketStoreId=process.env.FRESHWAY_TEST_MULTI_BASKET_STORE_ID;
const multiBasketLatitude=Number(process.env.FRESHWAY_TEST_MULTI_BASKET_LATITUDE);
const multiBasketLongitude=Number(process.env.FRESHWAY_TEST_MULTI_BASKET_LONGITUDE);
const multiBasketProductId=process.env.FRESHWAY_TEST_MULTI_BASKET_PRODUCT_ID;
const multiBasketSecondProductId=process.env.FRESHWAY_TEST_MULTI_BASKET_SECOND_PRODUCT_ID;
const multiBasketCategoryId=process.env.FRESHWAY_TEST_MULTI_BASKET_CATEGORY_ID;
const uiCategoryId=categoryId;
const uiPrimaryProductId=productId;

const mancherialAddress={
  houseFlat:'Mancherial Head Post Office',
  area:'Indra Nagar, Janmabhoomi Nagar',
  city:'Mancherial',
  district:'Mancherial',
  state:'Telangana',
  pincode:'504208',
  latitude,
  longitude
};

async function chooseMancherialAddress(page){
  await page.locator('#addressBtn').click();
  await expect(page.locator('#fwAddressManagerNew')).toBeVisible({timeout:20000});
  await page.locator('#fwAddressManagerNew').click();
  await expect(page.locator('#fwAddressGps')).toBeVisible({timeout:10000});
  await page.locator('#fwAddressGps').click();
  await expect(page.locator('#fwAddressLocationStatus')).toContainText('Delivery pin selected',{timeout:30000});
  await page.locator('#fwAddrName').fill('FreshWay Playwright Test');
  await page.locator('#fwAddrPhone').fill('9999999999');
  await page.locator('#fwAddrHouse').fill(mancherialAddress.houseFlat);
  await page.locator('#fwAddrArea').fill(mancherialAddress.area);
  await page.locator('#fwAddrCity').fill(mancherialAddress.city);
  await page.locator('#fwAddrPincode').fill(mancherialAddress.pincode);
  const selected=page.waitForResponse(response=>{
    const url=new URL(response.url());
    if(url.pathname!=='/api/delivery/store'||response.request().method()!=='POST')return false;
    const payload=response.request().postDataJSON()||{};
    const address=payload.address||{};
    return Math.abs(Number(address.latitude)-latitude)<0.00001&&Math.abs(Number(address.longitude)-longitude)<0.00001;
  },{timeout:20000});
  await page.locator('#fwAddressSave').click();
  const response=await selected;
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available,'Mancherial address must resolve to a serviceable active store').toBe(true);
  expect(result.code).toBe('AVAILABLE');
  expect(result.store?.id).toBe(storeId);
  expect(result.store?.name).toBe(storeName);
  await page.waitForFunction(expected=>
    window.FreshWayCustomerStoreCatalogue?.selectedStoreId()===expected,
    storeId,{timeout:20000}
  );
  await expect(page.locator('#homeAddress')).toContainText('Mancherial');
  return result.store;
}

test.beforeAll(() => {
  expect(storeId,'production must have an active store').toBeTruthy();
  expect(Number.isFinite(latitude)&&Number.isFinite(longitude),'production store must have map coordinates').toBe(true);
  expect(productId,'production must have a stocked live product').toBeTruthy();
  expect(categoryId,'stocked product must belong to an active category').toBeTruthy();
});

test('Mancherial Head Post Office address resolves to its active FreshWay store', async ({ request }) => {
  const response=await request.post('/api/delivery/store',{
    data:{address:mancherialAddress}
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available).toBe(true);
  expect(result.code).toBe('AVAILABLE');
  expect(result.store?.id).toBe(storeId);
  expect(result.store?.name).toBe(storeName);
});

test('Mancherial address availability selects the live store with real unreserved stock', async ({ request }) => {
  const response=await request.post('/api/delivery/availability',{
    data:{
      address:mancherialAddress,
      items:[{id:productId,qty:1}]
    }
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available).toBe(true);
  expect(result.code).toBe('AVAILABLE');
  expect(result.store?.id).toBe(storeId);
  expect(result.store?.name).toBeTruthy();
});

test('production availability fulfils a real two-product basket from one eligible active store', async ({ request }) => {
  test.skip(!multiBasketReady,'Read-only production D1 inspection did not find two live products with unreserved stock at one eligible store.');
  expect(multiBasketStoreId).toBeTruthy();
  expect(Number.isFinite(multiBasketLatitude)&&Number.isFinite(multiBasketLongitude)).toBe(true);
  expect(multiBasketProductId).toBeTruthy();
  expect(multiBasketSecondProductId).toBeTruthy();
  expect(multiBasketSecondProductId).not.toBe(multiBasketProductId);
  const response=await request.post('/api/delivery/availability',{
    data:{
      address:{latitude:multiBasketLatitude,longitude:multiBasketLongitude},
      items:[{id:multiBasketProductId,qty:1},{id:multiBasketSecondProductId,qty:1}]
    }
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available).toBe(true);
  expect(result.code).toBe('AVAILABLE');
  expect(result.store?.id).toBe(multiBasketStoreId);
  expect(result.store?.name).toBeTruthy();
});

test('production availability refuses to guess when the customer has no confirmed map pin', async ({ request }) => {
  const response=await request.post('/api/delivery/availability',{
    data:{address:{},items:[{id:productId,qty:1}]}
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available).toBe(false);
  expect(result.code).toBe('LOCATION_REQUIRED');
});

const outsideLatitude=Number(process.env.FRESHWAY_TEST_OUTSIDE_LATITUDE);
const outsideLongitude=Number(process.env.FRESHWAY_TEST_OUTSIDE_LONGITUDE);

test('production availability rejects a valid pin outside every active store radius', async ({ request }) => {
  expect(Number.isFinite(outsideLatitude)&&Number.isFinite(outsideLongitude)).toBe(true);
  const response=await request.post('/api/delivery/availability',{
    data:{address:{latitude:outsideLatitude,longitude:outsideLongitude},items:[{id:productId,qty:1}]}
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available).toBe(false);
  expect(result.code).toBe('AREA_UNAVAILABLE');
});


test('production checkout quote uses the real catalogue price and returns the selected cart lines', async ({ request }) => {
  const response=await request.post('/api/checkout/quote',{
    data:{items:[{id:productId,qty:1}],couponCode:''}
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(Number.isSafeInteger(Number(result.pricing?.finalTotal))).toBe(true);
  expect(Number(result.pricing.finalTotal)).toBeGreaterThanOrEqual(0);
  expect(result.pricing?.items).toHaveLength(1);
  expect(result.pricing.items[0].id).toBe(productId);
  expect(result.pricing.items[0].qty).toBe(1);
  expect(Number(result.pricing.items[0].price)).toBeGreaterThan(0);
});

test('customer order and session endpoints reject unauthenticated requests', async ({ request }) => {
  const session=await request.get('/api/auth/session');
  expect(session.status()).toBe(401);

  const orders=await request.get('/api/orders?customerId=production-playwright-guest');
  expect(orders.status()).toBe(401);

  const attemptedOrder=await request.post('/api/orders',{data:{}});
  expect(attemptedOrder.status()).toBe(401);
});

test('real customer app browses live products and preserves cart without creating an order', async ({ page }) => {
  const pageErrors=[];
  const serverErrors=[];
  let orderPostCount=0;
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('response',response=>{
    const url=new URL(response.url());
    if(url.pathname.startsWith('/api/')&&response.status()>=500)serverErrors.push({path:url.pathname,status:response.status()});
  });
  page.on('request',request=>{
    if(new URL(request.url()).pathname==='/api/orders'&&request.method()==='POST')orderPostCount++;
  });
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({latitude,longitude,accuracy:20});
  const documentResponse=await page.goto('/');
  expect(documentResponse?.status()).toBe(200);
  await page.waitForFunction(() =>
    typeof window.FreshWayCustomerStoreCatalogue?.switchToStore === 'function'
  );
  const storeSelection=await chooseMancherialAddress(page);
  expect(storeSelection.id).toBe(storeId);
  await expect(page.locator('#fwCategoryCatalogue [data-fw-category="'+uiCategoryId+'"]').first()).toBeVisible({timeout:20000});
  await page.locator('[data-fw-category="'+uiCategoryId+'"]').first().click();
  const addButton=page.locator('#productGrid [data-add="'+uiPrimaryProductId+'"]').first();
  await expect(addButton).toBeVisible({timeout:20000});
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(page.locator('#cartCount')).not.toHaveText('0 items');

  await page.reload();
  await expect(page.locator('#cartCount')).not.toHaveText('0 items');
  // Guest addresses are intentionally visit-only; select the same Mancherial pin
  // again after reload, then confirm the cart is still intact at that store.
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({latitude,longitude,accuracy:20});
  const reselectedStore=await chooseMancherialAddress(page);
  expect(reselectedStore.id).toBe(storeId);
  await expect(page.locator('#cartCount')).not.toHaveText('0 items');
  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#checkoutBtn')).toBeVisible();
  await expect(page.locator('#cartItems [data-fw-cart-product]')).toHaveCount(1);
  const availabilityRequests=[];
  page.on('request',request=>{
    if(new URL(request.url()).pathname==='/api/delivery/availability'&&request.method()==='POST')availabilityRequests.push(request);
  });
  const quoteResponse=page.waitForResponse(response=>
    new URL(response.url()).pathname==='/api/checkout/quote'&&response.request().method()==='POST'
  );
  const availabilityResponse=page.waitForResponse(response=>
    new URL(response.url()).pathname==='/api/delivery/availability'&&response.request().method()==='POST',
    {timeout:5000}
  ).catch(()=>null);
  await page.locator('#checkoutBtn').click();
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹');
  const quote=await (await quoteResponse).json();
  expect(quote.pricing?.items).toHaveLength(1);
  expect(String(quote.pricing.items[0].id)).toBe(String(uiPrimaryProductId));
  let response=await availabilityResponse;
  if(!response){
    const diagnostic=await page.evaluate(async()=>{
      const instance=window.FreshWayCustomerDeliveryBookingInstance;
      const state=document.querySelector('#checkoutDeliveryPicker')?.__fwDeliveryDateState;
      const before={instance:!!instance,enabled:instance?.checkoutEnabled?.()??false,destroyed:state?.destroyed??null,availability:state?.availability??null,cart:window.state?.cart??null};
      const result=await instance?.checkAvailability?.();
      return {before,result};
    });
    console.log('CHECKOUT_AVAILABILITY_DIAGNOSTIC '+JSON.stringify({requestCount:availabilityRequests.length,diagnostic}));
    throw new Error('Checkout entry did not automatically request delivery availability; manual diagnostic: '+JSON.stringify(diagnostic));
  }
  const availability=await response.json();
  expect(availabilityRequests[0]?.postDataJSON()?.items).toHaveLength(1);
  expect(availability.available).toBe(true);
  expect(availability.code).toBe('AVAILABLE');
  expect(availability.store?.id).toBe(storeId);
  expect(availability.store?.name).toBe(storeName);
  await expect(page.locator('[data-fw-delivery-availability]')).toContainText(storeName);

  await page.setViewportSize({width:390,height:844});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  expect(overflow,'customer app must not overflow horizontally at 390px').toBe(false);
  await page.screenshot({path:'test-results/production/customer-cart-mobile.png',fullPage:true});
  expect(orderPostCount,'production test must not submit a real order').toBe(0);
  expect(pageErrors,'production page must not throw uncaught JavaScript errors').toEqual([]);
  expect(serverErrors,'customer API must not return 5xx responses').toEqual([]);
});


const fallbackReady=process.env.FRESHWAY_TEST_FALLBACK_READY==='true';
const fallbackLatitude=Number(process.env.FRESHWAY_TEST_FALLBACK_LATITUDE);
const fallbackLongitude=Number(process.env.FRESHWAY_TEST_FALLBACK_LONGITUDE);
const nearestStoreId=process.env.FRESHWAY_TEST_NEAREST_STORE_ID;
const expectedFallbackStoreId=process.env.FRESHWAY_TEST_FALLBACK_STORE_ID;
const fallbackProductId=process.env.FRESHWAY_TEST_FALLBACK_PRODUCT_ID;

test('production availability falls back to the next-nearest active store with stock, without splitting the basket', async ({ request }) => {
  test.skip(!fallbackReady,'Read-only production D1 inspection did not find a safe overlapping two-store fallback fixture.');
  expect(Number.isFinite(fallbackLatitude)&&Number.isFinite(fallbackLongitude)).toBe(true);
  expect(nearestStoreId).toBeTruthy();
  expect(expectedFallbackStoreId).toBeTruthy();
  expect(fallbackProductId).toBeTruthy();
  expect(expectedFallbackStoreId).not.toBe(nearestStoreId);

  const response=await request.post('/api/delivery/availability',{
    data:{
      address:{latitude:fallbackLatitude,longitude:fallbackLongitude},
      items:[{id:fallbackProductId,qty:1}]
    }
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available).toBe(true);
  expect(result.code).toBe('AVAILABLE');
  expect(result.store?.id).toBe(expectedFallbackStoreId);
  expect(result.store?.id).not.toBe(nearestStoreId);
  expect(result.store?.name).toBeTruthy();
});
