import { test, expect } from '@playwright/test';

const workerOrigin = 'http://localhost:8787';
const pageOrigin = 'http://localhost:4173';

const primaryScreens = ['overview', 'orders', 'delivery', 'customers'];
const secondaryScreens = [
  'requests', 'messages', 'stores', 'catalogue', 'cash',
  'offers', 'notifications', 'reports', 'settings'
];

const readySelectors = {
  overview: '#kpis',
  orders: '#ordersList',
  delivery: '#deliveryList',
  customers: '#customersList',
  requests: '#customerRequestsManagement',
  messages: '#customerMessagesManagement',
  stores: '#storeManagement',
  catalogue: '#fwCategoryList',
  cash: '#cashSummary',
  offers: '#deliveryOffersAdmin',
  notifications: '#notificationHistory',
  reports: '#reportCards',
  settings: '#storeProfileForm'
};

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

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)].toFixed(1));
}

function summarize(values) {
  if (!values.length) return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
  return {
    count: values.length,
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    maxMs: Number(Math.max(...values).toFixed(1))
  };
}

async function signIn(page) {
  const shellStarted = performance.now();
  const shellResponse = await page.goto('/admin.html#overview', { waitUntil: 'load' });
  const shellLoadMs = performance.now() - shellStarted;
  expect(shellResponse?.status()).toBe(200);
  await expect(page.locator('#loginView')).toBeVisible();

  const loginStarted = performance.now();
  const loginResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/admin/login' &&
    response.request().method() === 'POST'
  );
  await page.locator('#adminToken').fill('isolated-admin-token');
  await page.locator('#connectBtn').click();
  const response = await loginResponse;
  expect(response.status()).toBe(200);
  await expect(page.locator('#appView')).toBeVisible();
  await expect(page.locator('#overview')).toHaveClass(/active/);
  await page.waitForLoadState('networkidle');
  const loginAndBootstrapMs = performance.now() - loginStarted;

  return { shellLoadMs, loginAndBootstrapMs };
}

test('Owner read-only performance audit measures shell, screen readiness and API timings on desktop and mobile', async ({ browser }) => {
  test.setTimeout(120_000);

  const report = {
    environment: 'isolated local Worker + fresh D1',
    dataMode: 'read-only after Owner login',
    desktop: null,
    mobile: null,
    thresholds: {
      shellLoadMs: 8000,
      loginAndBootstrapMs: 10000,
      screenNavigationP95Ms: 4000,
      screenNavigationMaxMs: 7000,
      adminApiP95Ms: 3000
    }
  };

  const runViewport = async ({ label, viewport, isMobile = false }) => {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      isMobile,
      hasTouch: isMobile,
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const apiStarted = new Map();
    const apiTimings = [];
    const apiFailures = [];
    const forbiddenWrites = [];
    const pageErrors = [];
    let activeScreen = null;

    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/admin/')) return;
      if (request.method() !== 'GET' && url.pathname !== '/api/admin/login') {
        forbiddenWrites.push({ method: request.method(), path: url.pathname });
      }
      if (activeScreen && request.method() === 'GET') {
        apiStarted.set(request, { startedAt: performance.now(), screen: activeScreen, path: url.pathname });
      }
    });
    page.on('requestfinished', request => {
      const started = apiStarted.get(request);
      if (!started) return;
      apiTimings.push({
        screen: started.screen,
        path: started.path,
        durationMs: Number((performance.now() - started.startedAt).toFixed(1))
      });
      apiStarted.delete(request);
    });
    page.on('requestfailed', request => {
      const started = apiStarted.get(request);
      if (!started) return;
      apiFailures.push({
        screen: started.screen,
        path: started.path,
        error: request.failure()?.errorText || 'request failed'
      });
      apiStarted.delete(request);
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (activeScreen && url.pathname.startsWith('/api/admin/') && response.status() >= 400) {
        apiFailures.push({
          screen: activeScreen,
          path: url.pathname,
          status: response.status()
        });
      }
    });

    try {
      await proxyOwnerAssets(page);
      await proxyWorkerApi(page);
      const loadMetrics = await signIn(page);
      activeScreen = 'overview';

      const measureScreen = async (screen, navigate) => {
        activeScreen = screen;
        const start = performance.now();
        await navigate();
        await expect(page.locator('#' + screen)).toHaveClass(/active/);
        await expect(page.locator(readySelectors[screen])).toBeVisible({ timeout: 12000 });
        await page.waitForLoadState('networkidle');
        const durationMs = Number((performance.now() - start).toFixed(1));
        const currentScreenApi = apiTimings.filter(x => x.screen === screen);
        return {
          screen,
          durationMs,
          apiRequestCount: currentScreenApi.length,
          apiP95Ms: summarize(currentScreenApi.map(x => x.durationMs)).p95Ms
        };
      };

      const screenMetrics = [];
      for (const screen of primaryScreens) {
        screenMetrics.push(await measureScreen(screen, async () => {
          await page.locator((isMobile ? '.mobile-nav' : '.side nav') + ' button[data-screen="' + screen + '"]').click();
        }));
      }

      for (const screen of secondaryScreens) {
        screenMetrics.push(await measureScreen(screen, async () => {
          if (isMobile) {
            await page.locator('#mobileMoreBtn').click();
            await expect(page.locator('#mobileMoreMenu')).toBeVisible();
            await page.locator('#mobileMoreMenu [data-more-screen="' + screen + '"]').click();
          } else {
            const more = page.locator('.side nav details.owner-nav-more');
            if (!(await more.evaluate(element => element.open))) await more.locator('summary').click();
            await more.locator('button[data-screen="' + screen + '"]').click();
          }
        }));
      }

      await expect(page.locator('#settings')).toHaveClass(/active/);
      await page.waitForLoadState('networkidle');

      const navDurations = screenMetrics.map(item => item.durationMs);
      const apiDurations = apiTimings.map(item => item.durationMs);
      const resourceSummary = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource')
          .filter(entry => /(?:^|\/)(?:admin\.js|admin\.css|owner-lifecycle\.js|owner-address-final\.js|frontend\/admin\/)/.test(new URL(entry.name).pathname));
        return {
          ownerAssetCount: resources.length,
          ownerAssetTransferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
          ownerAssetDurationMs: Number(resources.reduce((sum, entry) => sum + entry.duration, 0).toFixed(1))
        };
      });

      expect(pageErrors, label + ' must not raise uncaught browser errors').toEqual([]);
      expect(apiFailures, label + ' must not return failed Owner API responses').toEqual([]);
      expect(forbiddenWrites, label + ' performance navigation must not write to the API').toEqual([]);
      expect(navDurations.length).toBe(primaryScreens.length + secondaryScreens.length);
      expect(loadMetrics.shellLoadMs, label + ' Owner shell load').toBeLessThan(report.thresholds.shellLoadMs);
      expect(loadMetrics.loginAndBootstrapMs, label + ' Owner login and first bootstrap').toBeLessThan(report.thresholds.loginAndBootstrapMs);
      expect(percentile(navDurations, 0.95), label + ' navigation p95').toBeLessThan(report.thresholds.screenNavigationP95Ms);
      expect(Math.max(...navDurations), label + ' navigation max').toBeLessThan(report.thresholds.screenNavigationMaxMs);
      if (apiDurations.length) {
        expect(percentile(apiDurations, 0.95), label + ' Owner API p95').toBeLessThan(report.thresholds.adminApiP95Ms);
      }

      return {
        viewport,
        shellLoadMs: Number(loadMetrics.shellLoadMs.toFixed(1)),
        loginAndBootstrapMs: Number(loadMetrics.loginAndBootstrapMs.toFixed(1)),
        screenNavigation: {
          ...summarize(navDurations),
          screens: screenMetrics
        },
        ownerApi: {
          ...summarize(apiDurations),
          requestCount: apiTimings.length
        },
        ownerAssets: resourceSummary,
        failedApiRequests: apiFailures.length,
        nonReadApiWrites: forbiddenWrites.length,
        uncaughtPageErrors: pageErrors.length
      };
    } finally {
      activeScreen = null;
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await context.close();
    }
  };

  report.desktop = await runViewport({
    label: 'desktop',
    viewport: { width: 1440, height: 1000 }
  });
  report.mobile = await runViewport({
    label: 'mobile',
    viewport: { width: 390, height: 844 },
    isMobile: true
  });

  console.log('OWNER_PERFORMANCE_AUDIT ' + JSON.stringify(report));
});
