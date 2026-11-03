import { test, expect } from '@playwright/test';

const workerOrigin = 'http://localhost:8787';
const pageOrigin = 'http://localhost:4173';

async function proxyOwnerAssets(page) {
  // admin.html is served from the repository root in this test. Mirror the
  // production /admin/ asset aliases while keeping the Owner service worker
  // disabled in Playwright so every request remains deterministic.
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

    const response = await route.fetch({
      url: pageOrigin + targetPath + incoming.search
    });
    await route.fulfill({ response });
  });
}

async function proxyWorkerApi(page) {
  await page.route('**/api/**', async route => {
    const incoming = new URL(route.request().url());
    const target = workerOrigin + incoming.pathname + incoming.search;
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
}

test('Owner can navigate every implemented management screen against the real Worker + isolated D1', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  const navigationWrites = [];
  let checkingNavigation = false;

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', async response => {
    const url = new URL(response.url());
    // The login screen may initialise read-only widgets before authentication.
    // Those expected 401s are not part of the authenticated Owner screen sweep.
    if (checkingNavigation && url.pathname.startsWith('/api/') && response.status() >= 400) {
      const body = await response.text().catch(() => '');
      apiFailures.push({ path: url.pathname, status: response.status(), body: body.slice(0, 300) });
    }
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (checkingNavigation &&
        url.pathname.startsWith('/api/admin/') &&
        request.method() !== 'GET') {
      navigationWrites.push({ path: url.pathname, method: request.method() });
    }
  });

  try {
    await proxyOwnerAssets(page);
    await proxyWorkerApi(page);

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

    // Let the post-login overview and read-only bootstrap calls settle before
    // measuring the effect of simple navigation.
    await page.waitForLoadState('networkidle');
    checkingNavigation = true;

    const primaryScreens = ['overview', 'orders', 'delivery', 'customers'];
    const moreScreens = [
      'stores', 'requests', 'messages', 'cash', 'catalogue',
      'notifications', 'reports', 'offers', 'settings'
    ];

    for (const screen of primaryScreens) {
      await page.locator('.side nav button[data-screen="' + screen + '"]').click();
      await expect(page.locator('#' + screen)).toHaveClass(/active/);
    }

    const more = page.locator('.side nav details.owner-nav-more');
    await more.locator('summary').click();
    for (const screen of moreScreens) {
      await more.locator('button[data-screen="' + screen + '"]').click();
      await expect(page.locator('#' + screen)).toHaveClass(/active/);
    }

    // The Owner alert-history screen is intentionally reached from the
    // Notifications screen rather than being a separate sidebar destination.
    await page.locator('.side nav button[data-screen="notifications"]').click();
    await expect(page.locator('#notifications')).toHaveClass(/active/);
    await page.locator('#ownerOrderAlertsViewAll').click();
    await expect(page.locator('#owner-alert-history')).toHaveClass(/active/);

    await page.waitForLoadState('networkidle');
    checkingNavigation = false;

    expect(pageErrors).toEqual([]);
    expect(apiFailures).toEqual([]);
    expect(navigationWrites).toEqual([]);
    await page.screenshot({
      path: 'test-results/real-d1/owner-management-navigation.png',
      fullPage: true
    });
  } finally {
    checkingNavigation = false;
    await context.close();
  }
});
