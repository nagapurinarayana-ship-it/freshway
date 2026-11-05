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

  // Verify that the same persisted order and money snapshot are displayed in the
  // authenticated Owner UI, then issue and download its commercial receipt.
  const ownerPage = await context.newPage();
  await ownerPage.setViewportSize({ width: 1440, height: 1000 });
  const ownerPageErrors = [];
  ownerPage.on('pageerror', error => ownerPageErrors.push(error.message));
  await proxyWorkerApi(ownerPage);
  const ownerHome = await ownerPage.goto('/admin.html#orders');
  expect(ownerHome?.status()).toBe(200);
  await expect(ownerPage.locator('#loginView')).toBeVisible();
  const ownerLogin = ownerPage.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/admin/login' &&
    response.request().method() === 'POST'
  );
  await ownerPage.locator('#adminToken').fill('isolated-admin-token');
  await ownerPage.locator('#connectBtn').click();
  expect((await ownerLogin).status()).toBe(200);
  await expect(ownerPage.locator('#appView')).toBeVisible();

  const ownerCard = ownerPage.locator('#ordersList .order-card').filter({ hasText: placed.id });
  await expect(ownerCard).toBeVisible({ timeout: 20000 });
  await expect(ownerCard).toContainText('₹750');
  await expect(ownerCard).toContainText('Items ₹800');
  await expect(ownerCard).toContainText('₹50');
  await expect(ownerCard).toContainText('Delivery Free');
  await ownerCard.click();
  await expect(ownerPage.locator('#modalBody')).toContainText('₹750');
  await expect(ownerPage.locator('#modalBody')).toContainText('Groundnut Oil ×3 litre');
  await expect(ownerPage.locator('#modalBody')).toContainText('Basmati Rice ×1 kg');

  // Moving the isolated order to the dispatch state triggers the configured
  // local commercial receipt flow; it does not dispatch or alter any live order.
  const dispatch = await ownerPage.evaluate(async orderId => {
    const response = await fetch('/api/admin/orders/' + encodeURIComponent(orderId), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Out for Delivery' })
    });
    return { status: response.status, data: await response.json() };
  }, placed.id);
  expect(dispatch.status).toBe(200);
  expect(dispatch.data.invoice?.number).toBeTruthy();

  await ownerPage.reload();
  await expect(ownerPage.locator('#appView')).toBeVisible();
  const refreshedOwnerCard = ownerPage.locator('#ordersList .order-card').filter({ hasText: placed.id });
  await expect(refreshedOwnerCard).toBeVisible({ timeout: 20000 });
  await expect(refreshedOwnerCard).toContainText('₹750');
  await expect(refreshedOwnerCard).toContainText('Items ₹800');
  await expect(refreshedOwnerCard).toContainText('₹50');
  await expect(refreshedOwnerCard).toContainText('Delivery Free');
  await refreshedOwnerCard.click();
  await expect(ownerPage.locator('#modalBody')).toContainText('₹750');
  await expect(ownerPage.locator('#modalBody')).toContainText('Groundnut Oil ×3 litre');
  await expect(ownerPage.locator('#modalBody')).toContainText('Basmati Rice ×1 kg');

  // The Lifecycle panel currently omits an invoice control, so verify the
  // issued document through the same authenticated Owner PDF endpoint.
  const invoiceDownload = await ownerPage.evaluate(async orderId => {
    const response = await fetch('/api/admin/orders/' + encodeURIComponent(orderId) + '/invoice', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/pdf' }
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      disposition: response.headers.get('content-disposition') || '',
      signature: String.fromCharCode(...bytes.subarray(0, 5)),
      byteLength: bytes.length
    };
  }, placed.id);
  expect(invoiceDownload.status).toBe(200);
  expect(invoiceDownload.contentType).toContain('application/pdf');
  expect(invoiceDownload.disposition).toContain(dispatch.data.invoice.number.replace(/[^A-Za-z0-9_-]/g, '-'));
  expect(invoiceDownload.signature).toBe('%PDF-');
  expect(invoiceDownload.byteLength).toBeGreaterThan(1000);

  // Collect the cash-on-delivery payment from the Owner lifecycle control.
  // The following reads verify the saved D1 value rather than trusting the UI event.
  const paymentSaveResponse = ownerPage.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/orders/' + encodeURIComponent(placed.id) &&
      response.request().method() === 'PATCH';
  });
  await ownerPage.locator('#fwLifePayment').selectOption('Collected');
  expect((await paymentSaveResponse).status()).toBe(200);
  await expect(ownerPage.locator('#fwLifeSave')).toHaveText('Saved', { timeout: 20000 });

  const savedPayment = await ownerPage.evaluate(async orderId => {
    const response = await fetch('/api/admin/orders?search=' + encodeURIComponent(orderId) + '&limit=1&testOrders=0', {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await response.json();
    return { status: response.status, order: data.orders?.find(order => order.id === orderId) || null };
  }, placed.id);
  expect(savedPayment.status).toBe(200);
  expect(savedPayment.order).toMatchObject({ payment: 'Collected' });
  expect(savedPayment.order.paymentCollectedAt).toBeTruthy();

  // Hard reload must restore the collected state from the Worker/D1 order record.
  await ownerPage.reload();
  await expect(ownerPage.locator('#appView')).toBeVisible();
  const collectedOwnerCard = ownerPage.locator('#ordersList .order-card').filter({ hasText: placed.id });
  await expect(collectedOwnerCard).toBeVisible({ timeout: 20000 });
  await collectedOwnerCard.click();
  await expect(ownerPage.locator('#fwLifeStatus')).toHaveValue('Out for Delivery');
  await expect(ownerPage.locator('#fwLifePayment')).toHaveValue('Collected');

  // The Cash screen must move this COD order out of pending cash and into
  // today's collected total, using the persisted payment_collected_at timestamp.
  await ownerPage.evaluate(() => {
    const more = document.querySelector('.side nav details.owner-nav-more');
    if (more) more.open = true;
    document.querySelector('.side nav button[data-screen="cash"]')?.click();
  });
  await expect(ownerPage.locator('#cash')).toHaveClass(/active/);
  const cashCards = ownerPage.locator('#cashSummary .cash-summary-grid .report');
  await expect(cashCards).toHaveCount(2);
  // The preceding customer-store test leaves one independent ₹219 COD order
  // unpaid in this same isolated D1 database; it must remain visible as pending.
  // The current ₹750 order must be in collected cash, not pending cash.
  await expect(cashCards.nth(0)).toContainText('₹219', { timeout: 20000 });
  await expect(cashCards.nth(0)).toContainText('1 orders still outstanding');
  await expect(cashCards.nth(1)).toContainText('₹750', { timeout: 20000 });
  await expect(cashCards.nth(1)).toContainText('1 collections today');
  await expect(ownerPage.locator('#cashList')).toContainText('₹219');
  await expect(ownerPage.locator('#cashList')).not.toContainText(placed.id);

  // Keep the Cash screen usable at phone and narrow-tablet widths as well.
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  const mobileCashLayout = await ownerPage.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(mobileCashLayout.document).toBeLessThanOrEqual(mobileCashLayout.viewport + 1);
  await ownerPage.setViewportSize({ width: 810, height: 900 });
  const tabletCashLayout = await ownerPage.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(tabletCashLayout.document).toBeLessThanOrEqual(tabletCashLayout.viewport + 1);

  expect(ownerPageErrors).toEqual([]);


  await context.close();
});


test('Owner cancellation releases only the assigned store reservation and delivery fulfils it once', async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const phone = '9' + String(Date.now()).slice(-9);
  const customer = await context.request.post(workerOrigin + '/api/auth/register', {
    headers: { Origin: origin },
    data: { name: 'D1 Operations E2E', phone, passcode: '123456' }
  });
  expect(customer.status()).toBe(200);
  const account = await customer.json();
  const customerSession = (customer.headers()['set-cookie'] || '').match(/freshway-customer-session=([^;,\s]+)/);
  expect(customerSession).toBeTruthy();

  const login = await context.request.post(workerOrigin + '/api/admin/login', {
    headers: { Origin: origin },
    data: { token: 'isolated-admin-token' }
  });
  expect(login.status()).toBe(200);
  const ownerSession = (login.headers()['set-cookie'] || '').match(/__Host-freshway-admin-session=([^;,\s]+)/);
  expect(ownerSession).toBeTruthy();
  const ownerApi = (path, method = 'GET', data) => context.request.fetch(workerOrigin + path, {
    method,
    headers: { Origin: origin, 'X-Freshway-Admin-Session': ownerSession[1], 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { data })
  });
  const customerApi = (path, data) => context.request.fetch(workerOrigin + path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: 'freshway-customer-session=' + customerSession[1], 'Content-Type': 'application/json' },
    data
  });
  const inventory = async storeId => {
    const response = await ownerApi('/api/admin/delivery/stores/' + encodeURIComponent(storeId) + '/inventory');
    expect(response.status()).toBe(200);
    return (await response.json()).inventory;
  };
  const stock = (rows, id = 'oil-d1') => {
    const item = rows.find(row => row.id === id);
    expect(item).toBeTruthy();
    return { onHand: Number(item.on_hand), reserved: Number(item.reserved_qty) };
  };

  const newStoreResponse = await ownerApi('/api/admin/delivery/stores', 'POST', {
    name: 'D1 Operations Store 2',
    address: 'Isolated test fixture',
    latitude: 17.385044,
    longitude: 78.486671,
    serviceRadiusKm: 5
  });
  expect(newStoreResponse.status()).toBe(201);
  const secondStore = (await newStoreResponse.json()).store;
  const initialInventory = await inventory(secondStore.id);
  const seeded = await ownerApi('/api/admin/delivery/stores/' + encodeURIComponent(secondStore.id) + '/inventory', 'PATCH', {
    items: initialInventory.filter(row => Number(row.stock_managed) === 1)
      .map(row => ({ productId: row.id, stockQuantity: row.id === 'oil-d1' ? 7 : 6 }))
  });
  expect(seeded.status()).toBe(200);
  const activated = await ownerApi('/api/admin/delivery/stores/' + encodeURIComponent(secondStore.id), 'PATCH', { isActive: true });
  expect(activated.status()).toBe(200);

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const deliveryDate = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const createOrder = async storeId => {
    const response = await customerApi('/api/orders', {
      customerId: account.customerId,
      customer: { name: 'D1 Operations E2E', phone },
      address: {
        recipientName: 'D1 Operations E2E', house: '12', area: 'Operations Test Colony', city: 'Hyderabad', pincode: '500072',
        latitude: 17.385044, longitude: 78.486671, deliveryPhone: phone
      },
      storeId, preferredDeliveryDate: deliveryDate, items: [{ id: 'oil-d1', qty: 1 }]
    });
    expect(response.status()).toBe(201);
    const order = await response.json();
    expect(order.assignedStoreId).toBe(storeId);
    return order;
  };
  const setStatus = async (orderId, status) => {
    const response = await ownerApi('/api/admin/orders/' + encodeURIComponent(orderId), 'PATCH', { status });
    expect(response.status()).toBe(200);
    expect((await response.json()).status).toBe(status);
  };

  const storeOneBefore = stock(await inventory('store-d1'));
  const storeTwoBefore = stock(await inventory(secondStore.id));
  expect(storeTwoBefore).toEqual({ onHand: 7, reserved: 0 });

  const cancelled = await createOrder('store-d1');
  expect(stock(await inventory('store-d1'))).toEqual({
    onHand: storeOneBefore.onHand, reserved: storeOneBefore.reserved + 1
  });
  expect(stock(await inventory(secondStore.id))).toEqual(storeTwoBefore);
  await setStatus(cancelled.id, 'Cancelled');
  expect(stock(await inventory('store-d1'))).toEqual(storeOneBefore);
  expect(stock(await inventory(secondStore.id))).toEqual(storeTwoBefore);

  // A repeated cancellation must not release the same reservation twice.
  await setStatus(cancelled.id, 'Cancelled');
  expect(stock(await inventory('store-d1'))).toEqual(storeOneBefore);

  // Store 2 has its own stock and central-price fallback; Store 1 remains unchanged.
  const delivered = await createOrder(secondStore.id);
  expect(delivered.items[0].price).toBe(220);
  expect(stock(await inventory(secondStore.id))).toEqual({ onHand: 7, reserved: 1 });
  expect(stock(await inventory('store-d1'))).toEqual(storeOneBefore);
  for (const status of ['Confirmed', 'Processing', 'Ready', 'Out for Delivery', 'Delivered']) {
    await setStatus(delivered.id, status);
  }
  expect(stock(await inventory(secondStore.id))).toEqual({ onHand: 6, reserved: 0 });
  expect(stock(await inventory('store-d1'))).toEqual(storeOneBefore);

  const customerHistory = await context.request.get(workerOrigin + '/api/orders?customerId=' + encodeURIComponent(account.customerId), {
    headers: { Origin: origin, Cookie: 'freshway-customer-session=' + customerSession[1] }
  });
  expect(customerHistory.status()).toBe(200);
  const orders = (await customerHistory.json()).orders;
  expect(orders.find(order => order.id === cancelled.id)?.status).toBe('Cancelled');
  expect(orders.find(order => order.id === delivered.id)?.status).toBe('Delivered');

  await context.close();
});


test('Owner dispatch invoice is idempotent and cash reconciliation handles multiple stores, refunds and cancelled orders', async ({ browser }) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const phone = '9' + String(Date.now()).slice(-9);
  const customer = await context.request.post(workerOrigin + '/api/auth/register', {
    headers: { Origin: origin },
    data: { name: 'D1 Cash Reconciliation E2E', phone, passcode: '123456' }
  });
  expect(customer.status()).toBe(200);
  const account = await customer.json();
  const customerSession = (customer.headers()['set-cookie'] || '').match(/freshway-customer-session=([^;,\s]+)/);
  expect(customerSession).toBeTruthy();

  const login = await context.request.post(workerOrigin + '/api/admin/login', {
    headers: { Origin: origin },
    data: { token: 'isolated-admin-token' }
  });
  expect(login.status()).toBe(200);
  const ownerSession = (login.headers()['set-cookie'] || '').match(/__Host-freshway-admin-session=([^;,\s]+)/);
  expect(ownerSession).toBeTruthy();

  const ownerApi = (path, method = 'GET', data) => context.request.fetch(workerOrigin + path, {
    method,
    headers: {
      Origin: origin,
      'X-FreshWay-Admin-Session': ownerSession[1],
      'Content-Type': 'application/json'
    },
    ...(data === undefined ? {} : { data })
  });
  const customerApi = (path, data) => context.request.fetch(workerOrigin + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: 'freshway-customer-session=' + customerSession[1],
      'Content-Type': 'application/json'
    },
    data
  });
  const readReports = async () => {
    const response = await ownerApi('/api/admin/reports?range=today');
    expect(response.status()).toBe(200);
    return response.json();
  };
  const readOwnerOrder = async orderId => {
    const response = await ownerApi('/api/admin/orders?search=' + encodeURIComponent(orderId) + '&limit=1&testOrders=0');
    expect(response.status()).toBe(200);
    const data = await response.json();
    const order = data.orders.find(item => item.id === orderId);
    expect(order).toBeTruthy();
    return order;
  };
  const patchOrder = async (orderId, payload) => {
    const response = await ownerApi('/api/admin/orders/' + encodeURIComponent(orderId), 'PATCH', payload);
    const data = await response.json();
    expect(response.status(), 'Owner update must succeed: ' + JSON.stringify(payload) + ' — ' + JSON.stringify(data)).toBe(200);
    return data;
  };
  const readHistory = async orderId => {
    const response = await ownerApi('/api/admin/delivery/orders/' + encodeURIComponent(orderId) + '/history');
    expect(response.status()).toBe(200);
    return response.json();
  };
  const inventory = async storeId => {
    const response = await ownerApi('/api/admin/delivery/stores/' + encodeURIComponent(storeId) + '/inventory');
    expect(response.status()).toBe(200);
    return (await response.json()).inventory;
  };
  const stock = (rows, productId = 'oil-d1') => {
    const row = rows.find(item => item.id === productId);
    expect(row).toBeTruthy();
    return { onHand: Number(row.on_hand), reserved: Number(row.reserved_qty) };
  };

  const baseline = await readReports();
  const storeOneBefore = stock(await inventory('store-d1'));
  const newStore = await ownerApi('/api/admin/delivery/stores', 'POST', {
    name: 'D1 Reconciliation Store 2',
    address: 'Isolated cash and invoice test store',
    latitude: 17.385044,
    longitude: 78.486671,
    serviceRadiusKm: 5
  });
  expect(newStore.status()).toBe(201);
  const secondStore = (await newStore.json()).store;
  const emptyInventory = await inventory(secondStore.id);
  const seeded = await ownerApi('/api/admin/delivery/stores/' + encodeURIComponent(secondStore.id) + '/inventory', 'PATCH', {
    items: emptyInventory.filter(item => Number(item.stock_managed) === 1)
      .map(item => ({ productId: item.id, stockQuantity: item.id === 'oil-d1' ? 7 : 6 }))
  });
  expect(seeded.status()).toBe(200);
  const activated = await ownerApi('/api/admin/delivery/stores/' + encodeURIComponent(secondStore.id), 'PATCH', { isActive: true });
  expect(activated.status()).toBe(200);
  expect(Number((await activated.json()).store.is_active)).toBe(1);
  const storeTwoBefore = stock(await inventory(secondStore.id));
  expect(storeTwoBefore).toEqual({ onHand: 7, reserved: 0 });

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  const deliveryDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const createOrder = async storeId => {
    const response = await customerApi('/api/orders', {
      customerId: account.customerId,
      customer: { name: 'D1 Cash Reconciliation E2E', phone },
      address: {
        recipientName: 'D1 Cash Reconciliation E2E',
        house: '22', area: 'Cash Test Colony', city: 'Hyderabad', pincode: '500072',
        latitude: 17.385044, longitude: 78.486671, deliveryPhone: phone
      },
      storeId,
      preferredDeliveryDate: deliveryDate,
      items: [{ id: 'oil-d1', qty: 1 }]
    });
    const data = await response.json();
    expect(response.status(), 'customer order must be accepted: ' + JSON.stringify(data)).toBe(201);
    expect(data.assignedStoreId).toBe(storeId);
    return data;
  };

  // One COD order from each store. Store 1 has a ₹189 override; Store 2 falls
  // back to the central ₹220 price. Both include the configured ₹30 delivery fee.
  const cancelledOrder = await createOrder('store-d1');
  const dispatchedOrder = await createOrder(secondStore.id);
  expect(cancelledOrder).toMatchObject({ itemsSubtotal: 189, deliveryFee: 30, total: 219 });
  expect(dispatchedOrder).toMatchObject({ itemsSubtotal: 220, deliveryFee: 30, total: 250 });
  expect(dispatchedOrder.items[0]).toMatchObject({ id: 'oil-d1', qty: 1, price: 220, lineTotal: 220 });
  const afterCreation = await readReports();
  expect(afterCreation.cashPending - baseline.cashPending).toBe(469);
  expect(afterCreation.cashPendingOrders - baseline.cashPendingOrders).toBe(2);
  expect(stock(await inventory('store-d1'))).toEqual({ onHand: storeOneBefore.onHand, reserved: storeOneBefore.reserved + 1 });
  expect(stock(await inventory(secondStore.id))).toEqual({ onHand: 7, reserved: 1 });

  // The Store 1 order is cancelled before fulfilment. Its reserved stock is
  // released, its payment stays uncollected, and it must not remain in pending cash.
  const cancellation = await patchOrder(cancelledOrder.id, { status: 'Cancelled' });
  expect(cancellation.status).toBe('Cancelled');
  expect(stock(await inventory('store-d1'))).toEqual(storeOneBefore);
  const afterCancellation = await readReports();
  expect(afterCancellation.cashPending).toBe(baseline.cashPending + dispatchedOrder.total);
  expect(afterCancellation.cashPendingOrders).toBe(baseline.cashPendingOrders + 1);
  expect(afterCancellation.cancelled).toBe(baseline.cancelled + 1);
  expect(afterCancellation.cancelledValue).toBe(baseline.cancelledValue + cancelledOrder.total);

  // Dispatch must issue exactly one commercial invoice. Repeating dispatch and
  // progressing to Delivered must return the same invoice, not allocate another.
  for (const status of ['Confirmed', 'Processing', 'Ready', 'Out for Delivery']) {
    const saved = await patchOrder(dispatchedOrder.id, { status });
    expect(saved.status).toBe(status);
  }
  const dispatched = await readOwnerOrder(dispatchedOrder.id);
  expect(dispatched.status).toBe('Out for Delivery');
  expect(dispatched.invoice).toMatchObject({ documentType: 'commercial_invoice' });
  const invoiceNumber = dispatched.invoice.number;
  expect(invoiceNumber).toBeTruthy();

  const repeatedDispatch = await patchOrder(dispatchedOrder.id, { status: 'Out for Delivery' });
  expect(repeatedDispatch.status).toBe('Out for Delivery');
  expect(repeatedDispatch.invoice?.number).toBe(invoiceNumber);
  const afterRepeatedDispatch = await readOwnerOrder(dispatchedOrder.id);
  expect(afterRepeatedDispatch.invoice).toMatchObject({
    number: invoiceNumber,
    documentType: 'commercial_invoice'
  });

  const invoicePath = '/api/admin/orders/' + encodeURIComponent(dispatchedOrder.id) + '/invoice';
  const invoicePdf = await ownerApi(invoicePath);
  expect(invoicePdf.status()).toBe(200);
  expect(invoicePdf.headers()['content-type']).toContain('application/pdf');
  expect(invoicePdf.headers()['content-disposition']).toContain(
    invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '-')
  );
  const invoiceBytes = await invoicePdf.body();
  expect(invoiceBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(invoiceBytes.length).toBeGreaterThan(1000);

  const delivered = await patchOrder(dispatchedOrder.id, { status: 'Delivered' });
  expect(delivered.status).toBe('Delivered');
  expect(delivered.invoice?.number).toBe(invoiceNumber);
  const afterDelivered = await readOwnerOrder(dispatchedOrder.id);
  expect(afterDelivered).toMatchObject({
    status: 'Delivered',
    total: 250,
    itemsSubtotal: 220,
    deliveryFee: 30,
    payment: 'Not Collected',
    invoice: { number: invoiceNumber, documentType: 'commercial_invoice' }
  });
  expect(stock(await inventory(secondStore.id))).toEqual({ onHand: 6, reserved: 0 });
  expect(stock(await inventory('store-d1'))).toEqual(storeOneBefore);

  // Collection adds this Store 2 order exactly once to the cash total.
  const collected = await patchOrder(dispatchedOrder.id, { payment: 'Collected' });
  expect(collected.payment).toBe('Collected');
  const afterCollection = await readOwnerOrder(dispatchedOrder.id);
  expect(afterCollection.payment).toBe('Collected');
  expect(afterCollection.paymentCollectedAt).toBeTruthy();
  const originalCollectedAt = afterCollection.paymentCollectedAt;
  const historyAfterCollection = await readHistory(dispatchedOrder.id);
  const eventCountAfterCollection = historyAfterCollection.events.length;

  // A duplicate collection request is a successful no-op: timestamp and audit
  // history remain exactly as they were after the first collection.
  const repeatedCollection = await patchOrder(dispatchedOrder.id, { payment: 'Collected' });
  expect(repeatedCollection).toMatchObject({
    ok: true, noChange: true, payment: 'Collected'
  });
  const afterRepeatedCollection = await readOwnerOrder(dispatchedOrder.id);
  expect(afterRepeatedCollection.paymentCollectedAt).toBe(originalCollectedAt);
  const historyAfterRepeatedCollection = await readHistory(dispatchedOrder.id);
  expect(historyAfterRepeatedCollection.events).toHaveLength(eventCountAfterCollection);

  const afterCollectionReports = await readReports();
  expect(afterCollectionReports.cashPending).toBe(baseline.cashPending);
  expect(afterCollectionReports.cashPendingOrders).toBe(baseline.cashPendingOrders);
  expect(afterCollectionReports.cashCollected - baseline.cashCollected).toBe(dispatchedOrder.total);
  expect(afterCollectionReports.cashCollectedOrders - baseline.cashCollectedOrders).toBe(1);

  // Refund clears the current collection state. Refunded money is neither
  // counted as cash still due nor as cash currently retained by FreshWay.
  const refund = await patchOrder(dispatchedOrder.id, { payment: 'Refunded' });
  expect(refund.payment).toBe('Refunded');
  const refundedOrder = await readOwnerOrder(dispatchedOrder.id);
  expect(refundedOrder).toMatchObject({ status: 'Delivered', payment: 'Refunded', paymentCollectedAt: null });
  const afterRefund = await readReports();
  expect(afterRefund.cashPending).toBe(baseline.cashPending);
  expect(afterRefund.cashPendingOrders).toBe(baseline.cashPendingOrders);
  expect(afterRefund.cashCollected).toBe(baseline.cashCollected);
  expect(afterRefund.cashCollectedOrders).toBe(baseline.cashCollectedOrders);

  const historyAfterRefund = await readHistory(dispatchedOrder.id);
  const repeatedRefund = await patchOrder(dispatchedOrder.id, { payment: 'Refunded' });
  expect(repeatedRefund).toMatchObject({ ok: true, noChange: true, payment: 'Refunded' });
  expect((await readHistory(dispatchedOrder.id)).events).toHaveLength(historyAfterRefund.events.length);

  // The same issued invoice remains downloadable after refund; the PDF endpoint
  // reads the current payment state but does not create or renumber the invoice.
  const refundedInvoicePdf = await ownerApi(invoicePath);
  expect(refundedInvoicePdf.status()).toBe(200);
  expect(refundedInvoicePdf.headers()['content-type']).toContain('application/pdf');
  expect((await readOwnerOrder(dispatchedOrder.id)).invoice.number).toBe(invoiceNumber);

  // The customer-facing order history must show the cancellation and the
  // delivered/refunded state independently.
  const customerHistory = await context.request.get(
    workerOrigin + '/api/orders?customerId=' + encodeURIComponent(account.customerId),
    { headers: { Origin: origin, Cookie: 'freshway-customer-session=' + customerSession[1] } }
  );
  expect(customerHistory.status()).toBe(200);
  const orders = (await customerHistory.json()).orders;
  expect(orders.find(order => order.id === cancelledOrder.id)?.status).toBe('Cancelled');
  expect(orders.find(order => order.id === dispatchedOrder.id)).toMatchObject({
    status: 'Delivered', payment: 'Refunded'
  });

  await context.close();
});


test('Owner admin navigation, store prices and inventory stay reliable through refresh and responsive stress', async ({ browser }) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  const ownerPage = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  let captureApiFailures = false;
  ownerPage.on('pageerror', error => pageErrors.push(error.message));
  ownerPage.on('response', response => {
    if (!captureApiFailures || response.status() < 400) return;
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) {
      apiFailures.push({ status: response.status(), method: response.request().method(), path: url.pathname });
    }
  });
  await proxyWorkerApi(ownerPage);

  const home = await ownerPage.goto('/admin.html#overview');
  expect(home?.status()).toBe(200);
  await expect(ownerPage.locator('#loginView')).toBeVisible();
  const loginResponse = ownerPage.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/admin/login' &&
    response.request().method() === 'POST'
  );
  await ownerPage.locator('#adminToken').fill('isolated-admin-token');
  await ownerPage.locator('#connectBtn').click();
  expect((await loginResponse).status()).toBe(200);
  await expect(ownerPage.locator('#appView')).toBeVisible();
  captureApiFailures = true;
  await expect(ownerPage.locator('#kpis .kpi')).toHaveCount(4, { timeout: 20000 });

  // Exercise every Owner screen through the desktop navigation, then use the
  // built-in refresh action while each screen is active.
  const screens = [
    'orders', 'delivery', 'customers', 'stores', 'catalogue', 'cash',
    'offers', 'notifications', 'reports', 'settings', 'requests', 'messages'
  ];
  await ownerPage.locator('.side nav details.owner-nav-more').evaluate(element => { element.open = true; });
  for (const screen of screens) {
    const navButton = ownerPage.locator('.side nav button[data-screen="' + screen + '"]');
    await expect(navButton).toBeVisible();
    await navButton.click();
    await expect(ownerPage.locator('#' + screen)).toHaveClass(/active/);
    await ownerPage.locator('#refreshBtn').click();
    await expect(ownerPage.locator('#refreshBtn')).toBeEnabled();
    await expect(ownerPage.locator('#' + screen)).toHaveClass(/active/);
  }

  // Store 2 is edited only through the Owner workspace. This checks that its
  // price override, availability and physical inventory save together.
  await ownerPage.locator('.side nav button[data-screen="stores"]').click();
  await expect(ownerPage.locator('#stores')).toHaveClass(/active/);
  const storeTwoCard = ownerPage.locator('#storeManagement .fw-store-card').filter({ hasText: 'D1 Operations Store 2' });
  await expect(storeTwoCard).toHaveCount(1, { timeout: 20000 });
  const storeTwoId = await storeTwoCard.locator('[data-manage-store]').getAttribute('data-manage-store');
  expect(storeTwoId).toBeTruthy();
  await storeTwoCard.locator('[data-manage-store]').click();
  await expect(ownerPage.locator('#storeManagement .fw-managed-product')).toHaveCount(2, { timeout: 20000 });

  const oilPrice = ownerPage.locator('#storeManagement [data-catalogue-price="oil-d1"]');
  const oilOnHand = ownerPage.locator('#storeManagement [data-inventory-product="oil-d1"]');
  const riceAvailable = ownerPage.locator('#storeManagement [data-catalogue-available="rice-d1"]');
  const originalOilPrice = await oilPrice.inputValue();
  const originalOilStock = Number(await oilOnHand.inputValue());
  const originalRiceAvailability = await riceAvailable.isChecked();
  expect(originalOilStock).toBeGreaterThan(0);

  // Search and filters must work without removing products or switching stores.
  await ownerPage.locator('#storeManagement [data-store-product-search]').fill('Groundnut');
  await expect(ownerPage.locator('#storeManagement [data-managed-product]:visible')).toHaveCount(1);
  await expect(ownerPage.locator('#storeManagement [data-managed-product]:visible').first()).toContainText('Groundnut Oil');
  await ownerPage.locator('#storeManagement [data-store-product-search]').fill('');
  await ownerPage.locator('#storeManagement [data-stock-filter="all"]').click();

  await oilPrice.fill('218');
  await oilOnHand.fill(String(originalOilStock - 1));
  await riceAvailable.setChecked(false);
  await ownerPage.locator('#storeManagement [data-save-store-management]').click();
  await expect(ownerPage.locator('#storeManagement [data-store-management-status]')).toContainText('saved for this store', { timeout: 20000 });
  await expect(ownerPage.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue('218');
  await expect(ownerPage.locator('#storeManagement [data-inventory-product="oil-d1"]')).toHaveValue(String(originalOilStock - 1));
  await expect(ownerPage.locator('#storeManagement [data-catalogue-available="rice-d1"]')).not.toBeChecked();

  // A hard Owner refresh must retain the selected store and re-read saved values.
  await ownerPage.locator('#refreshBtn').click();
  await expect(ownerPage.locator('#refreshBtn')).toBeEnabled();
  await expect(ownerPage.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue('218', { timeout: 20000 });
  await expect(ownerPage.locator('#storeManagement [data-inventory-product="oil-d1"]')).toHaveValue(String(originalOilStock - 1));
  await expect(ownerPage.locator('#storeManagement [data-catalogue-available="rice-d1"]')).not.toBeChecked();

  // Store 2's customer catalogue reflects these changes; Store 1 remains intact.
  const storeTwoCatalogue = await ownerPage.evaluate(async storeId => {
    const response = await fetch('/api/products?storeId=' + encodeURIComponent(storeId), { cache: 'no-store' });
    const data = await response.json();
    return { status: response.status, products: data.products || [] };
  }, storeTwoId);
  expect(storeTwoCatalogue.status).toBe(200);
  expect(storeTwoCatalogue.products.map(product => product.id)).toEqual(['oil-d1']);
  expect(storeTwoCatalogue.products[0].price).toBe(218);
  const storeOneCatalogue = await ownerPage.evaluate(async () => {
    const response = await fetch('/api/products?storeId=store-d1', { cache: 'no-store' });
    const data = await response.json();
    return { status: response.status, products: data.products || [] };
  });
  expect(storeOneCatalogue.status).toBe(200);
  expect(storeOneCatalogue.products.map(product => product.id)).toEqual(['oil-d1', 'rice-d1']);
  expect(storeOneCatalogue.products[0].price).toBe(189);
  expect(storeOneCatalogue.products[1].price).toBe(233);

  // Restore the isolated fixture so this UI test leaves no changes for later tests.
  await ownerPage.locator('#storeManagement [data-catalogue-price="oil-d1"]').fill(originalOilPrice);
  await ownerPage.locator('#storeManagement [data-inventory-product="oil-d1"]').fill(String(originalOilStock));
  await ownerPage.locator('#storeManagement [data-catalogue-available="rice-d1"]').setChecked(originalRiceAvailability);
  await ownerPage.locator('#storeManagement [data-save-store-management]').click();
  await expect(ownerPage.locator('#storeManagement [data-store-management-status]')).toContainText('saved for this store', { timeout: 20000 });
  await expect(ownerPage.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue(originalOilPrice);
  await expect(ownerPage.locator('#storeManagement [data-inventory-product="oil-d1"]')).toHaveValue(String(originalOilStock));
  if (originalRiceAvailability) await expect(ownerPage.locator('#storeManagement [data-catalogue-available="rice-d1"]')).toBeChecked();
  else await expect(ownerPage.locator('#storeManagement [data-catalogue-available="rice-d1"]')).not.toBeChecked();

  // Store 1 retains its own override and physical stock.
  await ownerPage.locator('#storeManagement [data-close-store-management]').click();
  const storeOneCard = ownerPage.locator('#storeManagement .fw-store-card:has(button[data-manage-store="store-d1"])');
  await expect(storeOneCard).toHaveCount(1);
  await storeOneCard.locator('[data-manage-store]').click();
  await expect(ownerPage.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue('189');
  await expect(ownerPage.locator('#storeManagement [data-catalogue-price="rice-d1"]')).toHaveValue('233');
  await expect(ownerPage.locator('#storeManagement [data-inventory-product="oil-d1"]')).toHaveValue('10');

  // Stress mobile navigation and repeat key screens at phone, tablet and desktop widths.
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.locator('#mobileMoreBtn').click();
  await expect(ownerPage.locator('#mobileMoreMenu')).toBeVisible();
  await ownerPage.locator('#mobileMoreMenu [data-more-screen="stores"]').click();
  await expect(ownerPage.locator('#stores')).toHaveClass(/active/);
  await expect(ownerPage.locator('#storeManagement .fw-store-card').filter({ hasText: 'D1 Store' })).not.toHaveCount(0, { timeout: 20000 });
  await expect(ownerPage.locator('#storeManagement .fw-store-card').filter({ hasText: 'D1 Operations Store 2' })).not.toHaveCount(0, { timeout: 20000 });
  for (const width of [390, 810, 1440]) {
    await ownerPage.setViewportSize({ width, height: 900 });
    for (const screen of ['overview', 'orders', 'stores', 'cash', 'reports']) {
      await ownerPage.evaluate(id => window.navigateAdminScreen(id), screen);
      await expect(ownerPage.locator('#' + screen)).toHaveClass(/active/);
      const layout = await ownerPage.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth
      }));
      expect(layout.document, screen + ' overflows at ' + width + 'px').toBeLessThanOrEqual(layout.viewport + 1);
    }
  }

  // Repeated navigation and refresh should not strand the UI or fail API calls.
  for (const screen of ['stores', 'orders', 'delivery', 'stores', 'cash', 'reports', 'overview']) {
    await ownerPage.evaluate(id => window.navigateAdminScreen(id), screen);
    await expect(ownerPage.locator('#' + screen)).toHaveClass(/active/);
    await ownerPage.locator('#refreshBtn').click();
    await expect(ownerPage.locator('#refreshBtn')).toBeEnabled();
  }
  expect(pageErrors).toEqual([]);
  expect(apiFailures).toEqual([]);
  await context.close();
});


test('Owner catalogue UI blocks deletion while store stock remains and deletes a zero-stock product', async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 }
  });
  const ownerPage = await context.newPage();
  const pageErrors = [];
  ownerPage.on('pageerror', error => pageErrors.push(error.message));
  ownerPage.on('dialog', dialog => dialog.accept());
  await proxyWorkerApi(ownerPage);

  const home = await ownerPage.goto('/admin.html#overview');
  expect(home?.status()).toBe(200);
  await expect(ownerPage.locator('#loginView')).toBeVisible();
  const loginResponse = ownerPage.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/admin/login' &&
    response.request().method() === 'POST'
  );
  await ownerPage.locator('#adminToken').fill('isolated-admin-token');
  await ownerPage.locator('#connectBtn').click();
  expect((await loginResponse).status()).toBe(200);
  await expect(ownerPage.locator('#appView')).toBeVisible();

  const stockedName = 'UI Stock Delete Check ' + Date.now();
  const stockCreate = await ownerPage.evaluate(async ({ name }) => {
    const catalogueResponse = await fetch('/api/admin/catalogue', {
      credentials: 'include', cache: 'no-store'
    });
    const catalogue = await catalogueResponse.json();
    const categoryId = catalogue.categories[0]?.id;
    if (!categoryId) return { status: catalogueResponse.status, error: 'No fixture category available.' };
    const response = await fetch('/api/admin/catalogue/products', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, unit: 'kg', price: 99, categoryId, stockManaged: true,
        stockQuantity: 0, lowStockThreshold: 1
      })
    });
    return { status: response.status, data: await response.json(), categoryId };
  }, { name: stockedName });
  expect(stockCreate.status).toBe(201);
  const stockedProductId = stockCreate.data.product.id;
  const stockedCategoryId = stockCreate.categoryId;
  expect(stockedProductId).toBeTruthy();

  // Give this newly-created, unreferenced product on-hand stock in one store.
  // It has no order items or reservation history, so the API must reach the
  // positive-stock guard rather than a separate historical-order guard.
  const stockSave = await ownerPage.evaluate(async productId => {
    const path = '/api/admin/delivery/stores/store-d1/inventory';
    const currentResponse = await fetch(path, { credentials: 'include', cache: 'no-store' });
    const current = await currentResponse.json();
    if (!currentResponse.ok) return { status: currentResponse.status, data: current };
    const items = (current.inventory || []).filter(item => Number(item.stock_managed) === 1).map(item => ({
      productId: item.id,
      stockQuantity: item.id === productId ? 5 : Number(item.on_hand || 0)
    }));
    const response = await fetch(path, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    return { status: response.status, data: await response.json() };
  }, stockedProductId);
  expect(stockSave.status).toBe(200);

  await ownerPage.locator('.side nav details.owner-nav-more').evaluate(element => { element.open = true; });
  await ownerPage.locator('.side nav button[data-screen="catalogue"]').click();
  await expect(ownerPage.locator('#catalogue')).toHaveClass(/active/);
  await ownerPage.locator('#fwCategoryList [data-fw-manage="' + stockedCategoryId + '"]').click();
  await expect(ownerPage.locator('#fwProductsArea')).toContainText(stockedName);

  const blockedDelete = ownerPage.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/catalogue/products/' + encodeURIComponent(stockedProductId) &&
      response.request().method() === 'DELETE';
  });
  await ownerPage.locator('#fwProductsArea [data-fw-delete-product="' + stockedProductId + '"]').click();
  const blockedResponse = await blockedDelete;
  expect(blockedResponse.status()).toBe(400);
  await expect(ownerPage.locator('#toast')).toContainText('still has stock');
  await expect(ownerPage.locator('#fwProductsArea')).toContainText(stockedName);

  const uniqueName = 'UI Delete Check ' + Date.now();
  const createResult = await ownerPage.evaluate(async ({ categoryId, name }) => {
    const response = await fetch('/api/admin/catalogue/products', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, unit: 'kg', price: 99, categoryId, stockManaged: true,
        stockQuantity: 0, lowStockThreshold: 1
      })
    });
    return { status: response.status, data: await response.json() };
  }, { categoryId: stockedProduct.category_id, name: uniqueName });
  expect(createResult.status).toBe(201);
  const safeProductId = createResult.data.product.id;
  expect(safeProductId).toBeTruthy();

  await ownerPage.locator('#fwRefreshCatalogue').click();
  await ownerPage.locator('#fwCategoryList [data-fw-manage="' + stockedProduct.category_id + '"]').click();
  const safeDelete = ownerPage.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/catalogue/products/' + encodeURIComponent(safeProductId) &&
      response.request().method() === 'DELETE';
  });
  await ownerPage.locator('#fwProductsArea [data-fw-delete-product="' + safeProductId + '"]').click();
  expect((await safeDelete).status()).toBe(200);
  await expect(ownerPage.locator('#toast')).toContainText('Product deleted');
  await expect(ownerPage.locator('#fwProductsArea')).not.toContainText(uniqueName);

  const verify = await ownerPage.evaluate(async productId => {
    const response = await fetch('/api/admin/catalogue', { credentials: 'include', cache: 'no-store' });
    const data = await response.json();
    return { status: response.status, exists: data.products.some(product => product.id === productId) };
  }, safeProductId);
  expect(verify).toEqual({ status: 200, exists: false });
  expect(pageErrors).toEqual([]);
  await context.close();
});
