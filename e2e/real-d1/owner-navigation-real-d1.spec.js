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
  test.setTimeout(90_000);
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

    const alertsScriptResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/frontend/admin/order-alerts.js'
    );
    const home = await page.goto('/admin.html#overview');
    expect(home?.status()).toBe(200);
    expect((await alertsScriptResponse).status()).toBe(200);
    await expect.poll(() => page.evaluate(() => typeof window.FreshWayOwnerOrderAlerts)).toBe('object');
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

    // Owner alert controls must be backed by the actual script asset, not a
    // silent 404. Verify the status/list refresh actions use read-only APIs.
    await page.locator('.side nav button[data-screen="notifications"]').click();
    await expect(page.locator('#notifications')).toHaveClass(/active/);
    await expect(page.locator('#ownerOrderAlertToggle')).toBeVisible();
    await expect(page.locator('#ownerOrderAlertTest')).toBeVisible();

    const pushStatusResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/push/public-key'
    );
    const alertPreviewResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/admin/order-alerts' && url.searchParams.get('limit') === '3';
    });
    await page.locator('#ownerOrderAlertsRefresh').click();
    expect((await Promise.all([pushStatusResponse, alertPreviewResponse])).map(response => response.status())).toEqual([200, 200]);

    // The Owner alert-history screen is intentionally reached from the
    // Notifications screen rather than being a separate sidebar destination.
    const alertHistoryResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/admin/order-alerts' && url.searchParams.get('limit') === '20';
    });
    await page.locator('#ownerOrderAlertsViewAll').click();
    await expect(page.locator('#owner-alert-history')).toHaveClass(/active/);
    expect((await alertHistoryResponse).status()).toBe(200);
    await expect(page.locator('#ownerAlertHistoryList')).toBeVisible();

    const historyRefreshResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/admin/order-alerts' && url.searchParams.get('limit') === '20';
    });
    await page.locator('#ownerAlertHistoryRefresh').click();
    expect((await historyRefreshResponse).status()).toBe(200);

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
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});


test('Owner mobile More menu reopens after selecting secondary destinations repeatedly', async ({ browser }) => {
  test.setTimeout(90_000);
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

    // A transient Owner toast must not cover More-sheet actions on a phone.
    await page.evaluate(() => window.toast('Temporary visual-overlap check'));
    await expect(page.locator('#toast')).toHaveCSS('opacity', '0');
    const moreCard = page.locator('#mobileMoreMenu .mobile-more-card');
    const moreCardBox = await moreCard.boundingBox();
    expect(moreCardBox).toBeTruthy();
    const viewport = page.viewportSize();
    expect(moreCardBox.y).toBeGreaterThanOrEqual(0);
    expect(moreCardBox.y + moreCardBox.height).toBeLessThanOrEqual(viewport.height);
    const moreDestinations = page.locator('#mobileMoreMenu [data-more-screen]');
    await expect(moreDestinations).toHaveCount(9);
    for (let index = 0; index < await moreDestinations.count(); index++) {
      const destination = moreDestinations.nth(index);
      await expect(destination).toBeVisible();
      const bounds = await destination.boundingBox();
      expect(bounds).toBeTruthy();
      expect(bounds.y).toBeGreaterThanOrEqual(moreCardBox.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(moreCardBox.y + moreCardBox.height);
    }

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
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});

test('Owner browser Back, Forward and refresh preserve the correct screen and restore its data', async ({ browser }) => {
  test.setTimeout(90_000);
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

    const sequence = ['orders', 'delivery', 'stores', 'requests', 'messages', 'cash', 'customers', 'catalogue', 'notifications', 'reports', 'offers', 'settings'];
    for (const screen of sequence) await navigateTo(screen);

    // Every Back action must restore the screen represented by the popped history
    // entry, without adding another entry or leaving the URL and active screen apart.
    for (const screen of ['offers', 'reports', 'notifications', 'catalogue', 'customers', 'cash', 'messages', 'requests', 'stores', 'delivery', 'orders', 'overview']) {
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

    // First verify Stores refresh while editing a store's products and stock.
    // Refresh must preserve the selected store, but must never silently discard edits.
    await navigateTo('stores');
    const storeManageButton = page.locator('#storeManagement [data-manage-store="store-d1"]');
    await expect(storeManageButton).toBeVisible();
    await storeManageButton.click();
    await expect(page.locator('#storeManagement .fw-store-management-heading h2')).toHaveText('D1 Store');
    const groundnutStock = page.locator('#storeManagement [data-inventory-product="oil-d1"]');
    await expect(groundnutStock).toHaveValue('10');
    await groundnutStock.fill('7');

    let storeRefreshPrompt = '';
    page.once('dialog', async dialog => {
      storeRefreshPrompt = dialog.message();
      await dialog.dismiss();
    });
    await page.locator('#refreshBtn').click();
    expect(storeRefreshPrompt).toContain('unsaved Store changes');
    await expect(page.locator('#storeManagement .fw-store-management-heading h2')).toHaveText('D1 Store');
    await expect(groundnutStock).toHaveValue('7');

    const storeListReload = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/delivery/stores' &&
      response.request().method() === 'GET'
    );
    const storeCatalogueReload = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/delivery/stores/store-d1/catalogue' &&
      response.request().method() === 'GET'
    );
    const storeInventoryReload = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/delivery/stores/store-d1/inventory' &&
      response.request().method() === 'GET'
    );
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#refreshBtn').click();
    const storeReloadResponses = await Promise.all([storeListReload, storeCatalogueReload, storeInventoryReload]);
    expect(storeReloadResponses.map(response => response.status())).toEqual([200, 200, 200]);
    await expect(page.locator('#storeManagement .fw-store-management-heading h2')).toHaveText('D1 Store');
    await expect(groundnutStock).toHaveValue('10');

    // Exercise the global Refresh button on every Owner screen, with Stores first.
    const refreshScreens = [
      'stores', 'overview', 'orders', 'delivery', 'requests', 'messages',
      'cash', 'customers', 'catalogue', 'notifications', 'reports', 'offers', 'settings'
    ];
    for (const screen of refreshScreens) {
      await navigateTo(screen);
      await page.waitForLoadState('networkidle');
      const refreshed = page.waitForResponse(response =>
        new URL(response.url()).pathname.startsWith('/api/admin/') &&
        response.request().method() === 'GET'
      );
      await page.locator('#refreshBtn').click();
      expect((await refreshed).status()).toBe(200);
      await expect(page.locator('#' + screen)).toHaveClass(/active/);
      await page.waitForLoadState('networkidle');
    }

    // Owner notification history is nested under Notifications, so verify its refresh too.
    await navigateTo('notifications');
    await page.locator('#ownerOrderAlertsViewAll').click();
    await expect(page.locator('#owner-alert-history')).toHaveClass(/active/);
    await page.waitForLoadState('networkidle');
    const historyRefresh = page.waitForResponse(response =>
      new URL(response.url()).pathname.startsWith('/api/admin/') &&
      response.request().method() === 'GET'
    );
    await page.locator('#refreshBtn').click();
    expect((await historyRefresh).status()).toBe(200);
    await expect(page.locator('#owner-alert-history')).toHaveClass(/active/);

    // A browser-level hard refresh must restore every Owner screen from its route.
    for (const screen of refreshScreens) {
      await navigateTo(screen);
      await page.reload();
      await expect(page.locator('#appView')).toBeVisible();
      await expectHistoryScreen(screen);
      await page.waitForLoadState('networkidle');
    }
    await navigateTo('notifications');
    await page.locator('#ownerOrderAlertsViewAll').click();
    await expect(page.locator('#owner-alert-history')).toHaveClass(/active/);
    await page.reload();
    await expect(page.locator('#appView')).toBeVisible();
    await expectHistoryScreen('owner-alert-history');
    await page.waitForLoadState('networkidle');

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
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
