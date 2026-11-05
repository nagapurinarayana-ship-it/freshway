import { test, expect } from '@playwright/test';

const origin = 'http://localhost:4173';
const workerOrigin = 'http://localhost:8787';

async function proxyWorkerApi(page) {
  await page.route('**/api/**', async route => {
    const incoming = new URL(route.request().url());
    const target = workerOrigin + incoming.pathname + incoming.search;
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
}

async function addLocalSessionCookie(context, response, name, sameSite) {
  const setCookie = response.headers()['set-cookie'] || '';
  const match = setCookie.match(new RegExp(name + '=([^;,\\s]+)'));
  expect(match, name + ' must be set by the real Worker').toBeTruthy();
  await context.addCookies([{
    name,
    value: match[1],
    url: origin,
    secure: true,
    httpOnly: true,
    sameSite
  }]);
}

test('customer storefront uses the selected store catalogue and checks out at its server price', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const setup = await context.request.post(workerOrigin + '/api/auth/register', {
    headers: { Origin: origin },
    data: { name: 'D1 E2E Customer', phone: '9999999998', passcode: '123456' }
  });
  expect(setup.status()).toBe(200);
  const account = await setup.json();
  expect(account.customerId).toBeTruthy();
  await addLocalSessionCookie(context, setup, 'freshway-customer-session', 'None');

  const addressResponse = await context.request.post(workerOrigin + '/api/addresses', {
    headers: { Origin: origin },
    data: {
      label: 'Home',
      recipientName: 'D1 E2E Customer',
      deliveryPhone: '9999999998',
      houseFlat: '12',
      area: 'Test Colony',
      city: 'Hyderabad',
      pincode: '500072',
      latitude: 17.385044,
      longitude: 78.486671,
      isDefault: true
    }
  });
  expect(addressResponse.status()).toBe(201);
  expect((await addressResponse.json()).addresses).toHaveLength(1);

  const visibleCatalogue = await context.request.get(
    workerOrigin + '/api/products?storeId=store-d1',
    { headers: { Origin: origin } }
  );
  expect(visibleCatalogue.status()).toBe(200);
  const visibleProducts = (await visibleCatalogue.json()).products;
  expect(visibleProducts.map(product => product.id)).toEqual(['oil-d1', 'rice-d1']);
  expect(visibleProducts[0].price).toBe(189);

  const customerPage = await context.newPage();
  await proxyWorkerApi(customerPage);
  const pageErrors = [];
  customerPage.on('pageerror', error => pageErrors.push(error.message));
  const homeResponse = await customerPage.goto('/');
  expect(homeResponse?.status()).toBe(200);
  await expect(customerPage.locator('[data-fw-category="cat-oils-d1"]')).toBeVisible({ timeout: 20000 });
  await expect(customerPage.locator('#fwCategoryCatalogue')).toContainText('D1 Store');
  await customerPage.locator('[data-fw-category="cat-oils-d1"]').click();
  const oilCard = customerPage.locator('#productGrid .product-card').filter({ hasText: 'Groundnut Oil' });
  const riceCard = customerPage.locator('#productGrid .product-card').filter({ hasText: 'Basmati Rice' });
  await expect(oilCard).toContainText('₹189');
  await expect(riceCard).toContainText('₹233');
  await customerPage.locator('#productGrid [data-add="oil-d1"]').click();
  await customerPage.locator('#viewCartBtn').click();
  await expect(customerPage.locator('#cartItems')).toContainText('Groundnut Oil');
  await expect(customerPage.locator('#cartItems')).toContainText('₹189');
  await expect(customerPage.locator('#fwDeliveryPricing')).toContainText('₹189');
  await customerPage.locator('#checkoutBtn').click();
  await expect(customerPage.locator('#checkoutView')).toBeVisible();
  await expect(customerPage.locator('#fwCheckoutPricing')).toContainText('₹189');
  await expect(customerPage.locator('#fwCheckoutPricing')).toContainText('₹30');
  await expect(customerPage.locator('#fwCheckoutPricing')).toContainText('₹219');
  await expect(customerPage.locator('#checkoutTotal')).toHaveText('₹219');
  await expect(customerPage.locator('[data-fw-delivery-availability]')).toContainText('D1 Store', { timeout: 20000 });

  const orderResponsePromise = customerPage.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST'
  );
  await customerPage.locator('#checkoutForm button[type="submit"]').click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(201);
  const placed = await orderResponse.json();
  expect(placed.assignedStoreId).toBe('store-d1');
  expect(placed.items[0].id).toBe('oil-d1');
  expect(placed.items[0].price).toBe(189);
  expect(placed.itemsSubtotal).toBe(189);
  expect(placed.deliveryFee).toBe(30);
  expect(placed.couponDiscount).toBe(0);
  expect(placed.total).toBe(219);
  await expect(customerPage.locator('#confirmationView')).toBeVisible();
  await expect(customerPage.locator('#confirmationView')).toContainText('₹' + placed.total.toLocaleString('en-IN'));
  expect(pageErrors).toEqual([]);

  await context.close();
});


test('customer mobile UI applies a fixed coupon to a multi-item store basket and persists the exact threshold price in D1', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 }
  });
  const setup = await context.request.post(workerOrigin + '/api/auth/register', {
    headers: { Origin: origin },
    data: { name: 'D1 Money E2E Customer', phone: '9999999997', passcode: '123456' }
  });
  expect(setup.status()).toBe(200);
  const account = await setup.json();
  expect(account.customerId).toBeTruthy();
  await addLocalSessionCookie(context, setup, 'freshway-customer-session', 'None');

  const addressResponse = await context.request.post(workerOrigin + '/api/addresses', {
    headers: { Origin: origin },
    data: {
      label: 'Home',
      recipientName: 'D1 Money E2E Customer',
      deliveryPhone: '9999999997',
      houseFlat: '24',
      area: 'Test Colony',
      city: 'Hyderabad',
      pincode: '500072',
      latitude: 17.385044,
      longitude: 78.486671,
      isDefault: true
    }
  });
  expect(addressResponse.status()).toBe(201);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await proxyWorkerApi(page);
  const home = await page.goto('/');
  expect(home?.status()).toBe(200);

  await expect(page.locator('[data-fw-category="cat-oils-d1"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-fw-category="cat-oils-d1"]').click();
  const oilAdd = page.locator('#productGrid [data-add="oil-d1"]');
  await expect(oilAdd).toBeVisible();
  await expect(page.locator('#productGrid .product-price').first()).toContainText('₹189');
  await oilAdd.click();
  const oilPlus = page.locator('#productGrid [data-plus="oil-d1"]');
  await expect(oilPlus).toBeVisible();
  await oilPlus.click();
  await oilPlus.click();

  // The customer must return to the category list before choosing Rice.
  await page.locator('#fwCategoryBack button').click();
  await expect(page.locator('[data-fw-category="cat-rice-d1"]')).toBeVisible();
  await page.locator('[data-fw-category="cat-rice-d1"]').click();
  const riceCard = page.locator('#productGrid .product-card').filter({ hasText: 'Basmati Rice' });
  const riceAdd = riceCard.locator('[data-add="rice-d1"]');
  await expect(riceCard).toContainText('₹233');
  await expect(riceAdd).toBeVisible();
  await riceAdd.click();

  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#cartItems')).toContainText('Groundnut Oil');
  await expect(page.locator('#cartItems')).toContainText('Basmati Rice');
  await expect(page.locator('#cartItems')).toContainText('₹567');
  await expect(page.locator('#cartItems')).toContainText('₹233');

  // Exact threshold: 3 × ₹189 + ₹233 = ₹800. A ₹50 fixed coupon
  // reduces the payable amount to ₹750 and free delivery remains earned.
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹800');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('Free');

  await expect(page.locator('#fwAvailableCoupons')).toContainText('WELCOME50');
  await page.locator('#fwCouponCode').fill('WELCOME50');
  await page.locator('[data-fw-apply-coupon]').click();
  await expect(page.locator('#fwCouponStatus')).toContainText('Coupon applied');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹50');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹750');

  await page.locator('#checkoutBtn').click();
  await expect(page.locator('#checkoutView')).toBeVisible();
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹800');
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹50');
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹750');
  await expect(page.locator('#checkoutTotal')).toHaveText('₹750');
  await expect(page.locator('[data-fw-delivery-availability]')).toContainText('D1 Store', { timeout: 20000 });

  const responsive = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(responsive.documentWidth).toBeLessThanOrEqual(responsive.viewport + 1);
  expect(responsive.bodyWidth).toBeLessThanOrEqual(responsive.viewport + 1);
  await page.screenshot({ path: 'test-results/real-d1/customer-money-check-mobile.png', fullPage: true });

  const orderResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST'
  );
  await page.locator('#checkoutForm button[type="submit"]').click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(201);
  const placed = await orderResponse.json();

  expect(placed.assignedStoreId).toBe('store-d1');
  expect(placed.itemsSubtotal).toBe(800);
  expect(placed.deliveryFee).toBe(0);
  expect(placed.couponCode).toBe('WELCOME50');
  expect(placed.couponDiscount).toBe(50);
  expect(placed.total).toBe(750);
  expect(placed.pricingBreakdownKnown).toBe(true);
  expect(placed.items).toHaveLength(2);
  const oil = placed.items.find(item => item.id === 'oil-d1');
  const rice = placed.items.find(item => item.id === 'rice-d1');
  expect(oil).toMatchObject({ qty: 3, price: 189, lineTotal: 567 });
  expect(rice).toMatchObject({ qty: 1, price: 233, lineTotal: 233 });

  // Re-read the order through the authenticated customer API, proving that
  // D1 saved the same money snapshot that the UI and create-order response showed.
  const savedResponse = await context.request.get(
    workerOrigin + '/api/orders?customerId=' + encodeURIComponent(account.customerId),
    { headers: { Origin: origin } }
  );
  expect(savedResponse.status()).toBe(200);
  const savedPayload = await savedResponse.json();
  const savedOrder = savedPayload.orders.find(order => order.id === placed.id);
  expect(savedOrder).toBeTruthy();
  expect(savedOrder).toMatchObject({
    total: 750,
    pricingBreakdownKnown: true,
    itemsSubtotal: 800,
    deliveryFee: 0,
    couponCode: 'WELCOME50',
    couponDiscount: 50
  });
  expect(savedOrder.items).toHaveLength(2);
  expect(savedOrder.items.find(item => item.id === 'oil-d1')).toMatchObject({ qty: 3, price: 189, lineTotal: 567 });
  expect(savedOrder.items.find(item => item.id === 'rice-d1')).toMatchObject({ qty: 1, price: 233, lineTotal: 233 });
  expect(pageErrors).toEqual([]);

  await context.close();
});
