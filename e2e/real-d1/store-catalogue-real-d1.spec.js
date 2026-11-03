import { test, expect } from '@playwright/test';

const origin = 'http://localhost:4173';
const workerOrigin = 'http://localhost:8787';

async function proxyWorkerApi(page, ownerSession = '') {
  await page.route('**/api/**', async route => {
    const incoming = new URL(route.request().url());
    const target = workerOrigin + incoming.pathname + incoming.search;
    const headers = { ...route.request().headers() };
    if (ownerSession && incoming.pathname.startsWith('/api/admin/')) {
      headers.cookie = [headers.cookie || '', '__Host-freshway-admin-session=' + ownerSession].filter(Boolean).join('; ');
    }
    const response = await route.fetch({ url: target, headers });
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

test('real Worker + isolated D1: Owner edits store catalogue, customer checks out at the saved local price', async ({ browser }) => {
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

  const ownerLogin = await context.request.post(workerOrigin + '/api/admin/login', {
    headers: { Origin: origin },
    data: { token: 'isolated-owner-token' }
  });
  expect(ownerLogin.status()).toBe(200);
  const ownerCookie = (ownerLogin.headers()['set-cookie'] || '')
    .match(/__Host-freshway-admin-session=([^;,\\s]+)/);
  expect(ownerCookie, 'Owner login must return an admin session').toBeTruthy();

  const ownerPage = await context.newPage();
  await ownerPage.addInitScript(() => {
    sessionStorage.setItem('freshway-admin-auth', '1');
    localStorage.setItem('freshway-admin-auth', '1');
  });
  await proxyWorkerApi(ownerPage, ownerCookie[1]);
  await ownerPage.goto('/admin.html#stores');
  await expect(ownerPage.locator('#authState')).toHaveText('Connected');
  await expect(ownerPage.locator('#storeManagement')).toContainText('D1 Store');
  await ownerPage.locator('[data-edit-catalogue="store-d1"]').click();
  const panel = ownerPage.locator('.fw-store-catalogue-panel');
  await expect(panel).toBeVisible();
  await ownerPage.locator('[data-catalogue-price="oil-d1"]').fill('189');
  await ownerPage.locator('[data-catalogue-available="rice-d1"]').uncheck();
  await ownerPage.locator('[data-save-catalogue]').click();
  await expect(ownerPage.locator('#storeManagement')).toContainText('Store product availability and prices saved.');

  const visibleCatalogue = await context.request.get(
    workerOrigin + '/api/products?storeId=store-d1',
    { headers: { Origin: origin } }
  );
  expect(visibleCatalogue.status()).toBe(200);
  const visibleProducts = (await visibleCatalogue.json()).products;
  expect(visibleProducts.map(product => product.id)).toEqual(['oil-d1']);
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
  await expect(customerPage.locator('#productGrid .product-card')).toContainText('Groundnut Oil');
  await expect(customerPage.locator('#productGrid .product-price').first()).toContainText('₹189');
  await expect(customerPage.locator('#productGrid .product-card')).not.toContainText('Basmati Rice');
  await customerPage.locator('#productGrid [data-add="oil-d1"]').click();
  await customerPage.locator('#viewCartBtn').click();
  await expect(customerPage.locator('#cartItems')).toContainText('Groundnut Oil');
  await expect(customerPage.locator('#cartItems')).toContainText('₹189');
  await expect(customerPage.locator('#fwDeliveryPricing')).toContainText('₹189');
  await customerPage.locator('#checkoutBtn').click();
  await expect(customerPage.locator('#checkoutView')).toBeVisible();
  await expect(customerPage.locator('#fwCheckoutPricing')).toContainText('₹189');
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
  await expect(customerPage.locator('#confirmationView')).toBeVisible();
  await expect(customerPage.locator('#confirmationView')).toContainText('₹' + placed.total.toLocaleString('en-IN'));
  expect(pageErrors).toEqual([]);

  await context.close();
});
