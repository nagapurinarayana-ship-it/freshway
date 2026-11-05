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

async function navigateToStores(page) {
  const more = page.locator('.side nav details.owner-nav-more');
  if (!(await more.evaluate(element => element.open))) await more.locator('summary').click();
  const storesButton = more.locator('button[data-screen="stores"]');
  await expect(storesButton).toBeVisible();
  await storesButton.click();
  await expect(page.locator('#stores')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#stores');
  await expect(page.locator('#storeManagement [data-manage-store="store-d1"]')).toBeVisible();
}

test('Owner Refresh preserves the selected Store workspace and protects unsaved inventory edits', async ({ browser }) => {
  test.setTimeout(75_000);
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
    await navigateToStores(page);

    await page.locator('#storeManagement [data-manage-store="store-d1"]').click();
    const stock = page.locator('#storeManagement [data-inventory-product="oil-d1"]');
    await expect(stock).toBeVisible();
    await expect(stock).toHaveValue('10');
    await stock.fill('17');

    const dialogPromise = page.waitForEvent('dialog', { timeout: 5000 }).catch(() => null);
    await page.locator('#refreshBtn').click();
    const dialog = await dialogPromise;
    expect(dialog, 'Refresh must ask before discarding unsaved Store inventory edits').not.toBeNull();
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();

    await expect(page.locator('#storeManagement .fw-store-management-panel')).toBeVisible();
    await expect(stock).toHaveValue('17');
    await expect(page.locator('#stores')).toHaveClass(/active/);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
