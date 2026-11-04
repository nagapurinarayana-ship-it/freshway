import { test, expect } from '@playwright/test';

const workerOrigin = 'http://localhost:8787';
const pageOrigin = 'http://localhost:4173';

async function proxyOwnerAssets(page) {
  await page.route(url => url.pathname.startsWith('/admin/'), async route => {
    const incoming = new URL(route.request().url());
    let targetPath = incoming.pathname;
    if (targetPath !== '/admin/sw.js' &&
        targetPath !== '/admin/manifest.webmanifest' &&
        !targetPath.startsWith('/admin/icons/')) {
      targetPath = targetPath.replace(/^\/admin(?=\/)/, '');
    } else if (targetPath.startsWith('/admin/icons/')) {
      targetPath = targetPath.replace(/^\/admin\/icons\//, '/icons/');
    }
    const response = await route.fetch({ url: pageOrigin + targetPath + incoming.search });
    await route.fulfill({ response });
  });
}

async function proxyWorkerApi(page) {
  await page.route('**/api/**', async route => {
    const incoming = new URL(route.request().url());
    const response = await route.fetch({ url: workerOrigin + incoming.pathname + incoming.search });
    await route.fulfill({ response });
  });
}

async function signIn(page) {
  const home = await page.goto('/admin.html#overview');
  expect(home?.status()).toBe(200);
  await expect(page.locator('#loginView')).toBeVisible();
  const loginResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/admin/login' &&
    response.request().method() === 'POST'
  );
  await page.locator('#adminToken').fill('isolated-admin-token');
  await page.locator('#connectBtn').click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page.locator('#appView')).toBeVisible();
  await expect(page.locator('#overview')).toHaveClass(/active/);
  await page.waitForLoadState('networkidle');
}

async function navigateTo(page, screen) {
  const primary = page.locator('.side nav button[data-screen="' + screen + '"]');
  if (await primary.count()) {
    await primary.click();
  } else {
    const more = page.locator('.side nav details.owner-nav-more');
    if (!(await more.evaluate(element => element.open))) {
      await more.locator('summary').click();
    }
    await more.locator('button[data-screen="' + screen + '"]').click();
  }
  await expect(page.locator('#' + screen)).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#' + screen);
}

async function browserHistory(page, direction, screen) {
  await page.evaluate(direction === 'back' ? () => history.back() : () => history.forward());
  await expect(page.locator('#' + screen)).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#' + screen);
}

test('Owner Back and Forward restore screens, including Catalogue, and direct refresh keeps the route', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await proxyOwnerAssets(page);
    await proxyWorkerApi(page);
    await signIn(page);

    await navigateTo(page, 'orders');
    await navigateTo(page, 'stores');

    await browserHistory(page, 'back', 'orders');
    await browserHistory(page, 'back', 'overview');
    await browserHistory(page, 'forward', 'orders');

    await navigateTo(page, 'catalogue');
    await browserHistory(page, 'back', 'orders');
    await browserHistory(page, 'forward', 'catalogue');

    // A hard reload must restore the active hash, authenticate from the
    // existing Owner session, and reload Catalogue data rather than Overview.
    const reloaded = await page.reload();
    expect(reloaded?.status()).toBe(200);
    await expect(page.locator('#appView')).toBeVisible();
    await expect(page.locator('#catalogue')).toHaveClass(/active/);
    await expect(page.locator('#fwCategoryList')).toBeVisible();
    await expect(page.locator('#fwCategoryList')).toContainText('Oils');
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Owner Refresh reloads secondary screens without losing unsaved store edits', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const waitForGet = path => page.waitForRequest(request =>
    request.method() === 'GET' && new URL(request.url()).pathname === path
  );
  const refresh = async path => {
    const request = waitForGet(path);
    await page.locator('#refreshBtn').click();
    await request;
    await page.waitForLoadState('networkidle');
  };

  try {
    await proxyOwnerAssets(page);
    await proxyWorkerApi(page);
    await signIn(page);

    await navigateTo(page, 'stores');
    await refresh('/api/admin/delivery/stores');

    // Open a store, change an in-memory field, and verify Refresh asks before
    // discarding it. Cancelling must keep the workspace and the typed value.
    await page.locator('#storeManagement [data-manage-store="store-d1"]').click();
    const stock = page.locator('#storeManagement [data-inventory-product="oil-d1"]');
    await expect(stock).toBeVisible();
    await stock.fill('17');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#refreshBtn').click();
    await expect(stock).toHaveValue('17');
    await expect(page.locator('#storeManagement .fw-store-management-panel')).toBeVisible();

    await navigateTo(page, 'requests');
    await refresh('/api/admin/delivery/requests');

    await navigateTo(page, 'messages');
    await refresh('/api/admin/customer-messages');

    await navigateTo(page, 'offers');
    await refresh('/api/admin/delivery-offers');

    await navigateTo(page, 'settings');
    const profileRequest = waitForGet('/api/admin/store-profile');
    const invoiceRequest = waitForGet('/api/admin/invoice-settings');
    const deletionsRequest = waitForGet('/api/admin/account-deletion-requests');
    await page.locator('#refreshBtn').click();
    await Promise.all([profileRequest, invoiceRequest, deletionsRequest]);
    await page.waitForLoadState('networkidle');

    await navigateTo(page, 'notifications');
    const notificationsRequest = waitForGet('/api/admin/notifications/history');
    const alertsRequest = waitForGet('/api/admin/order-alerts');
    await page.locator('#refreshBtn').click();
    await Promise.all([notificationsRequest, alertsRequest]);
    await page.waitForLoadState('networkidle');

    await page.locator('#ownerOrderAlertsViewAll').click();
    await expect(page.locator('#owner-alert-history')).toHaveClass(/active/);
    await refresh('/api/admin/order-alerts');

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
