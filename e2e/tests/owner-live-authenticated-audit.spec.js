import { test, expect } from '@playwright/test';

// This spec handles a production admin credential; never retain traces, screenshots or video.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const LIVE_BASE_URL_RAW = process.env.FRESHWAY_LIVE_BASE_URL || 'https://fwcoldpressed.in';
const LIVE_BASE_URL = LIVE_BASE_URL_RAW.endsWith('/') ? LIVE_BASE_URL_RAW.slice(0, -1) : LIVE_BASE_URL_RAW;
const OWNER_AUDIT_TOKEN = String(process.env.FRESHWAY_OWNER_AUDIT_TOKEN || '').trim();

test('LIVE Owner authenticated audit: read-only dashboard, operations and settings', async ({ page }) => {
  test.skip(!OWNER_AUDIT_TOKEN, 'Configure the GitHub Actions secret FRESHWAY_OWNER_AUDIT_TOKEN to enable the authenticated production audit.');
  test.setTimeout(240000);

  const pageErrors = [];
  const apiGets = [];
  const blockedWrites = [];
  let loginRequests = 0;

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== new URL(LIVE_BASE_URL).origin || !url.pathname.startsWith('/api/')) return;
    if (response.request().method().toUpperCase() === 'GET') {
      apiGets.push({ path: url.pathname, status: response.status() });
    }
  });

  // Production write guard: allow the single sign-in request; block every other
  // non-GET API request, including order, payment, stock, settings and push writes.
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = new URL(request.url()).pathname;
    if (method === 'GET') {
      await route.continue();
      return;
    }
    if (method === 'POST' && path === '/api/admin/login' && loginRequests === 0) {
      loginRequests += 1;
      await route.continue();
      return;
    }
    blockedWrites.push({ method, path });
    await route.fulfill({
      status: 405,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Mutation blocked by read-only production Owner audit.' })
    });
  });

  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(LIVE_BASE_URL + '/admin/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('#loginView')).toBeVisible();
  await expect(page.locator('#adminToken')).toBeVisible();

  const loginResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/login' && response.request().method().toUpperCase() === 'POST';
  });
  await page.locator('#adminToken').fill(OWNER_AUDIT_TOKEN);
  await page.locator('#connectBtn').click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status(), 'production Owner authentication must succeed').toBe(200);
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/, { timeout: 30000 });
  await expect(page.locator('#authState')).toContainText('Connected');

  async function expectGet(path) {
    await expect.poll(
      () => apiGets.some(item => item.path === path),
      { timeout: 30000, message: 'Owner should request ' + path }
    ).toBe(true);
    const responses = apiGets.filter(item => item.path === path);
    expect(
      responses.some(item => item.status === 200),
      path + ' should return HTTP 200; received ' + responses.map(item => item.status).join(', ')
    ).toBe(true);
  }

  async function navigate(screen) {
    const direct = page.locator('.side button[data-screen="' + screen + '"]');
    if (await direct.count()) {
      await direct.first().click();
    } else {
      const more = page.locator('.owner-nav-more');
      if (!(await more.evaluate(element => element.open))) await more.locator('summary').click();
      await more.locator('button[data-screen="' + screen + '"]').click();
    }
    await expect(page.locator('#' + screen)).toHaveClass(/active/, { timeout: 15000 });
  }

  // Dashboard: summary, business totals and preview queries.
  await expect(page.locator('#overview')).toHaveClass(/active/);
  for (const path of [
    '/api/admin/summary',
    '/api/admin/reports',
    '/api/admin/orders',
    '/api/admin/customers',
    '/api/admin/products'
  ]) await expectGet(path);

  // Orders: inspect the live list and, where an order exists, open its details.
  await navigate('orders');
  await expectGet('/api/admin/orders');
  const liveOrderCards = page.locator('#ordersList [data-order]');
  if (await liveOrderCards.count()) {
    await liveOrderCards.first().click();
    await expect(page.locator('#modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#fwLifeStatus')).toBeVisible();
    await page.locator('#modalClose').click();
    await expect(page.locator('#modal')).toHaveClass(/hidden/);
  }

  // Customers, delivery and cash are browse-only.
  await navigate('customers');
  await expectGet('/api/admin/customers');

  await navigate('delivery');
  await expectGet('/api/admin/orders');

  await navigate('cash');
  await expectGet('/api/admin/reports');
  await expectGet('/api/admin/orders');

  // Catalogue: load categories/products and promotions; optionally expand a
  // category to render its current product list without editing anything.
  await navigate('catalogue');
  await expectGet('/api/admin/catalogue');
  await expectGet('/api/admin/promotions');
  const manageCategory = page.locator('#fwCategoryList [data-fw-manage]').first();
  if (await manageCategory.count()) {
    await manageCategory.click();
    await expect(page.locator('#fwProductsArea')).toBeVisible();
  }

  // Store management and customer requests are separate GET-only screens.
  await navigate('stores');
  await expectGet('/api/admin/delivery/stores');
  const inventoryButton = page.locator('#storeManagement [data-edit-inventory]').first();
  if (await inventoryButton.count()) {
    await inventoryButton.click();
    await expectGet('/api/admin/delivery/stores');
    await expect.poll(
      () => apiGets.some(item => item.path.includes('/api/admin/delivery/stores/') && item.path.endsWith('/inventory')),
      { timeout: 30000, message: 'Store inventory should load for inspection' }
    ).toBe(true);
  }

  await navigate('requests');
  await expectGet('/api/admin/delivery/requests');

  await navigate('messages');
  await expectGet('/api/admin/customer-messages');

  // Communication history is inspected, but push permissions, subscriptions,
  // test notifications and broadcasts are deliberately left untouched.
  await navigate('notifications');
  await expectGet('/api/admin/notifications/history');
  await expectGet('/api/admin/push/public-key');
  await expectGet('/api/admin/order-alerts');

  const viewAllAlerts = page.locator('#ownerOrderAlertsViewAll');
  if (await viewAllAlerts.count()) {
    await viewAllAlerts.click();
    await expect(page.locator('#owner-alert-history')).toHaveClass(/active/);
    await expectGet('/api/admin/order-alerts');
  }

  await navigate('offers');
  await expectGet('/api/admin/delivery-offers');

  await navigate('reports');
  await expectGet('/api/admin/reports');

  await navigate('settings');
  await expectGet('/api/admin/store-profile');
  await expectGet('/api/admin/invoice-settings');

  expect(loginRequests, 'exactly one production sign-in should be attempted').toBe(1);
  expect(blockedWrites, 'no production data/settings mutation is allowed').toEqual([]);
  expect(pageErrors, 'Owner screens should not throw uncaught JavaScript errors').toEqual([]);
});
