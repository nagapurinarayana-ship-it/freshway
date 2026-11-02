import { test, expect } from '@playwright/test';

const storeId=process.env.FRESHWAY_TEST_STORE_ID;
const latitude=Number(process.env.FRESHWAY_TEST_LATITUDE);
const longitude=Number(process.env.FRESHWAY_TEST_LONGITUDE);
const productId=process.env.FRESHWAY_TEST_PRODUCT_ID;
const categoryId=process.env.FRESHWAY_TEST_CATEGORY_ID;

test.beforeAll(() => {
  expect(storeId,'production must have an active store').toBeTruthy();
  expect(Number.isFinite(latitude)&&Number.isFinite(longitude),'production store must have map coordinates').toBe(true);
  expect(productId,'production must have a stocked live product').toBeTruthy();
  expect(categoryId,'stocked product must belong to an active category').toBeTruthy();
});

test('production availability selects the active store with real unreserved stock', async ({ request }) => {
  const response=await request.post('/api/delivery/availability',{
    data:{
      address:{latitude,longitude},
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

test('production availability refuses to guess when the customer has no confirmed map pin', async ({ request }) => {
  const response=await request.post('/api/delivery/availability',{
    data:{address:{},items:[{id:productId,qty:1}]}
  });
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.available).toBe(false);
  expect(result.code).toBe('LOCATION_REQUIRED');
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
  const productsResponse=page.waitForResponse(response=>
    new URL(response.url()).pathname==='/api/products'&&response.request().method()==='GET'
  );
  const documentResponse=await page.goto('/');
  expect(documentResponse?.status()).toBe(200);
  const apiResponse=await productsResponse;
  expect(apiResponse.status()).toBe(200);
  const payload=await apiResponse.json();
  expect(Array.isArray(payload.products)).toBe(true);
  expect(payload.products.length).toBeGreaterThan(0);

  const category=page.locator('[data-fw-category="'+categoryId+'"]').first();
  await expect(category).toBeVisible({timeout:20000});
  await category.click();
  const addButton=page.locator('#productGrid [data-add="'+productId+'"]').first();
  await expect(addButton).toBeVisible({timeout:20000});
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(page.locator('#cartCount')).not.toHaveText('0 items');

  await page.reload();
  await expect(page.locator('#cartCount')).not.toHaveText('0 items');
  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#checkoutBtn')).toBeVisible();
  await page.locator('#checkoutBtn').click();
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹');

  await page.setViewportSize({width:390,height:844});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  expect(overflow,'customer app must not overflow horizontally at 390px').toBe(false);
  await page.screenshot({path:'test-results/production/customer-cart-mobile.png',fullPage:true});
  expect(orderPostCount,'production test must not submit a real order').toBe(0);
  expect(pageErrors,'production page must not throw uncaught JavaScript errors').toEqual([]);
  expect(serverErrors,'customer API must not return 5xx responses').toEqual([]);
});
