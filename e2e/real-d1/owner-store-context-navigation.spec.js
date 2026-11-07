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
      targetPath = targetPath.startsWith('/admin/') ? targetPath.slice('/admin'.length) : targetPath;
    } else if (targetPath.startsWith('/admin/icons/')) {
      targetPath = targetPath.startsWith('/admin/icons/') ? targetPath.slice('/admin/icons'.length) : targetPath;
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
    new URL(response.url()).pathname === '/api/admin/login' && response.request().method() === 'POST'
  );
  await page.locator('#adminToken').fill('isolated-admin-token');
  await page.locator('#connectBtn').click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page.locator('#appView')).toBeVisible();
  await expect(page.locator('#overview')).toHaveClass(/active/);
  await page.waitForLoadState('networkidle');
}

async function navigateToStores(page) {
  const more = page.locator('.side nav details.owner-nav-more');
  if (!(await more.evaluate(element => element.open))) await more.locator('summary').click();
  await more.locator('button[data-screen="stores"]').click();
  await expect(page.locator('#stores')).toHaveClass(/active/);
  await expect(page.locator('#storeManagement [data-manage-store="store-d1"]')).toBeVisible();
}

test('Owner history restores the exact Store workspace when moving to another screen and Back', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  const nonReadRequests = [];
  let auditWrites = false;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (auditWrites && url.pathname.startsWith('/api/admin/') && request.method() !== 'GET') {
      nonReadRequests.push({ path: url.pathname, method: request.method() });
    }
  });

  try {
    await proxyOwnerAssets(page);
    await proxyWorkerApi(page);
    await signIn(page);
    auditWrites = true;

    // Repeating the active destination should refresh it without creating
    // indistinguishable browser-history entries.
    await page.locator('.side nav button[data-screen="orders"]').click();
    await expect(page.locator('#orders')).toHaveClass(/active/);
    const historyLength = await page.evaluate(() => history.length);
    await page.locator('.side nav button[data-screen="orders"]').click();
    await expect(page.locator('#orders')).toHaveClass(/active/);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    await navigateToStores(page);
    await page.locator('#storeManagement [data-manage-store="store-d1"]').click();
    const heading = page.locator('#storeManagement .fw-store-management-heading h2');
    await expect(heading).toHaveText('D1 Store');
    const price = page.locator('#storeManagement [data-catalogue-price="oil-d1"]');
    const inventory = page.locator('#storeManagement [data-inventory-product="oil-d1"]');
    await expect(price).toBeVisible();
    await expect(inventory).toBeVisible();
    const expectedPrice = await price.inputValue();
    const expectedInventory = await inventory.inputValue();
    await expect.poll(() => page.evaluate(() => history.state?.storeId)).toBe('store-d1');

    // A changed Store value must survive a rejected section-navigation prompt.
    const dirtyInventory = String(Number(expectedInventory) + 1);
    await inventory.fill(dirtyInventory);
    let menuPrompt = '';
    page.once('dialog', async dialog => {
      menuPrompt = dialog.message();
      await dialog.dismiss();
    });
    await page.locator('.side nav button[data-screen="orders"]').click();
    expect(menuPrompt).toMatch(/unsaved Store changes/i);
    await expect(page.locator('#stores')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => history.state?.storeId)).toBe('store-d1');
    await expect(inventory).toHaveValue(dirtyInventory);
    await inventory.fill(expectedInventory);

    // Moving to a different Owner section must create a distinct history entry,
    // not collapse Store management back to the generic Stores list.
    await page.locator('.side nav button[data-screen="orders"]').click();
    await expect(page.locator('#orders')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => history.state?.screen)).toBe('orders');

    await page.goBack();
    await expect(page.locator('#stores')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => history.state?.storeId)).toBe('store-d1');
    await expect(heading).toHaveText('D1 Store');
    await expect(price).toHaveValue(expectedPrice);
    await expect(inventory).toHaveValue(expectedInventory);

    await page.goForward();
    await expect(page.locator('#orders')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => history.state?.screen)).toBe('orders');
    await page.goBack();
    await expect(heading).toHaveText('D1 Store');

    // Reloading while inside the nested workspace must rehydrate the same store,
    // not show Overview or an unselected Stores list first.
    await page.reload();
    await expect(page.locator('#appView')).toBeVisible();
    await expect(page.locator('#stores')).toHaveClass(/active/);
    await expect(heading).toHaveText('D1 Store');
    await expect(price).toHaveValue(expectedPrice);
    await expect(inventory).toHaveValue(expectedInventory);

    // Browser Back must also ask before leaving a dirty Store workspace. Staying
    // must restore the Store ID in history and keep the edited value on screen.
    const dirtyBeforeBack = String(Number(expectedInventory) + 2);
    await inventory.fill(dirtyBeforeBack);
    const backDialogPromise = page.waitForEvent('dialog');
    const backPromise = page.goBack();
    const backDialog = await backDialogPromise;
    expect(backDialog.message()).toMatch(/unsaved Store changes/i);
    await backDialog.dismiss();
    await backPromise;
    await expect(page.locator('#stores')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => history.state?.storeId)).toBe('store-d1');
    await expect(heading).toHaveText('D1 Store');
    await expect(inventory).toHaveValue(dirtyBeforeBack);
    await inventory.fill(expectedInventory);

    // Global Refresh must expose its pending state, restore the button after the
    // selected store's list/detail requests finish, and keep the same workspace.
    let failStoreRefresh = false;
    await page.route('**/api/admin/delivery/stores', async route => {
      if (failStoreRefresh) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Refresh temporarily unavailable' })
        });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 350));
      const incoming = new URL(route.request().url());
      const response = await route.fetch({ url: workerOrigin + incoming.pathname + incoming.search });
      await route.fulfill({ response });
    });
    const listRefresh = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/delivery/stores' && response.request().method() === 'GET'
    );
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#refreshBtn')).toBeDisabled();
    await expect(page.locator('#refreshBtn')).toHaveAttribute('aria-busy', 'true');
    expect((await listRefresh).status()).toBe(200);
    await expect(page.locator('#refreshBtn')).toBeEnabled();
    await expect(page.locator('#refreshBtn')).not.toHaveAttribute('aria-busy', 'true');
    await expect(heading).toHaveText('D1 Store');
    await expect(price).toHaveValue(expectedPrice);
    await expect(inventory).toHaveValue(expectedInventory);

    // Failure feedback must also be visible and the global Refresh control
    // must recover from the error instead of remaining disabled/spinning.
    failStoreRefresh = true;
    const failedListRefresh = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/delivery/stores' && response.request().method() === 'GET'
    );
    await page.locator('#refreshBtn').click();
    expect((await failedListRefresh).status()).toBe(503);
    await expect(page.locator('#refreshBtn')).toBeEnabled();
    await expect(page.locator('#refreshBtn')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#storeManagement [data-store-management-status]')).toContainText(
      'Could not refresh stores: Refresh temporarily unavailable'
    );
    await expect(heading).toHaveText('D1 Store');
    await expect(price).toHaveValue(expectedPrice);
    await expect(inventory).toHaveValue(expectedInventory);

    // Repeat the nested workspace history flow at phone width through the
    // actual Owner More sheet. This catches mobile-only menu/history regressions.
    failStoreRefresh = false;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobileMoreBtn').click();
    await expect(page.locator('#mobileMoreMenu')).toBeVisible();
    await page.locator('#mobileMoreMenu [data-more-screen="stores"]').click();
    await expect(page.locator('#stores')).toHaveClass(/active/);
    await expect(page.locator('#storeManagement [data-manage-store="store-d1"]')).toBeVisible();
    await page.goBack();
    await expect.poll(() => page.evaluate(() => history.state?.storeId)).toBe('store-d1');
    await expect(heading).toHaveText('D1 Store');
    await expect(price).toHaveValue(expectedPrice);
    await expect(inventory).toHaveValue(expectedInventory);
    await page.reload();
    await expect(page.locator('#stores')).toHaveClass(/active/);
    await expect(heading).toHaveText('D1 Store');
    await expect(price).toHaveValue(expectedPrice);
    await expect(inventory).toHaveValue(expectedInventory);

    expect(pageErrors).toEqual([]);
    expect(nonReadRequests).toEqual([]);
  } finally {
    auditWrites = false;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
