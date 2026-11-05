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


test('Owner mobile More menu reopens after selecting secondary destinations repeatedly', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  let checkingNavigation = false;

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', async response => {
    const url = new URL(response.url());
    if (checkingNavigation && url.pathname.startsWith('/api/') && response.status() >= 400) {
      const body = await response.text().catch(() => '');
      apiFailures.push({ path: url.pathname, status: response.status(), body: body.slice(0, 300) });
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
    await expect(page.locator('.mobile-nav')).toBeVisible();
    await page.waitForLoadState('networkidle');
    checkingNavigation = true;

    for (const screen of ['stores', 'requests', 'messages', 'catalogue', 'cash', 'offers', 'notifications', 'reports', 'settings']) {
      await page.locator('#mobileMoreBtn').click();
      await expect(page.locator('#mobileMoreMenu')).toBeVisible();
      await page.locator('#mobileMoreMenu [data-more-screen="' + screen + '"]').click();
      await expect(page.locator('#' + screen)).toHaveClass(/active/);
      // Selection dismisses the overlay but leaves its DOM node hidden. The next
      // More tap must create a fresh visible menu instead of only removing that node.
      await expect(page.locator('#mobileMoreMenu')).toHaveClass(/hidden/);
    }

    // The explicit close control must also allow a subsequent open.
    await page.locator('#mobileMoreBtn').click();
    await expect(page.locator('#mobileMoreMenu')).toBeVisible();
    await page.locator('#mobileMoreClose').click();
    await expect(page.locator('#mobileMoreMenu')).toHaveClass(/hidden/);
    await page.locator('#mobileMoreBtn').click();
    await expect(page.locator('#mobileMoreMenu')).toBeVisible();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    }));
    expect(layout.horizontalOverflow).toBe(false);
    expect(pageErrors).toEqual([]);
    expect(apiFailures).toEqual([]);

    await page.screenshot({
      path: 'test-results/real-d1/owner-mobile-more-menu-reopen.png',
      fullPage: true
    });
  } finally {
    checkingNavigation = false;
    await context.close();
  }
});

test('Owner browser Back, Forward and refresh preserve the correct screen and restore its data', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];

  page.on('pageerror', error => pageErrors.push(error.message));

  const navigateTo = async screen => {
    const primary = page.locator('.side nav button[data-screen="' + screen + '"]');
    if (await primary.isVisible()) {
      await primary.click();
    } else {
      const more = page.locator('.side nav details.owner-nav-more');
      if (!(await more.evaluate(el => el.open))) await more.locator('summary').click();
      const secondary = more.locator('button[data-screen="' + screen + '"]');
      await expect(secondary).toBeVisible();
      await secondary.click();
    }
    await expect(page.locator('#' + screen)).toHaveClass(/active/);
    await expect(page).toHaveURL(new RegExp('#' + screen + '$'));
    await expect.poll(() => page.evaluate(() => history.state?.screen)).toBe(screen);
  };

  const expectHistoryScreen = async screen => {
    await expect(page.locator('#' + screen)).toHaveClass(/active/);
    await expect(page).toHaveURL(new RegExp('#' + screen + '$'));
    await expect.poll(() => page.evaluate(() => history.state?.screen)).toBe(screen);
  };

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

    const sequence = ['orders', 'delivery', 'stores', 'catalogue', 'offers', 'settings'];
    for (const screen of sequence) await navigateTo(screen);

    // Every Back action must restore the screen represented by the popped history
    // entry, without adding another entry or leaving the URL and active screen apart.
    for (const screen of ['offers', 'catalogue', 'stores', 'delivery', 'orders', 'overview']) {
      await page.evaluate(() => history.back());
      await expectHistoryScreen(screen);
    }

    // Forward must replay the same screen sequence exactly once.
    for (const screen of sequence) {
      await page.evaluate(() => history.forward());
      await expectHistoryScreen(screen);
    }

    // A hard refresh must reopen the same authenticated screen, not flash Overview
    // or silently fall back to a stale route.
    await page.reload();
    await expect(page.locator('#appView')).toBeVisible();
    await expectHistoryScreen('settings');
    await expect(page.locator('#storeProfileForm')).toBeVisible();

    // The global refresh action must also reload secondary management screens,
    // not silently do nothing outside the original Overview/Orders/Delivery set.
    const refreshChecks = [
      { screen: 'stores', endpoint: '/api/admin/delivery/stores' },
      { screen: 'requests', endpoint: '/api/admin/delivery/requests' },
      { screen: 'messages', endpoint: '/api/admin/customer-messages' },
      { screen: 'offers', endpoint: '/api/admin/delivery-offers' },
      { screen: 'settings', endpoint: '/api/admin/store-profile' }
    ];
    for (const check of refreshChecks) {
      await navigateTo(check.screen);
      await page.waitForLoadState('networkidle');
      const refreshed = page.waitForResponse(response =>
        new URL(response.url()).pathname === check.endpoint &&
        response.request().method() === 'GET'
      );
      await page.locator('#refreshBtn').click();
      expect((await refreshed).status()).toBe(200);
      await expect(page.locator('#' + check.screen)).toHaveClass(/active/);
    }

    // Catalogue is the screen that previously erased history state. Confirm its
    // content rehydrates after a direct route load and a full refresh.
    await page.goto('/admin.html#catalogue');
    await expect(page.locator('#appView')).toBeVisible();
    await expect(page.locator('#catalogue')).toHaveClass(/active/);
    await expect(page.locator('#fwCategoryList')).toBeVisible();
    await expect.poll(() => page.locator('#fwCategoryList').innerText()).toContain('Oils');

    await page.reload();
    await expect(page.locator('#appView')).toBeVisible();
    await expect(page.locator('#catalogue')).toHaveClass(/active/);
    await expect(page.locator('#fwCategoryList')).toBeVisible();
    await expect.poll(() => page.locator('#fwCategoryList').innerText()).toContain('Oils');

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
