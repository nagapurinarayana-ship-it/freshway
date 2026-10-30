import { test, expect } from '@playwright/test';

const LIVE_BASE_URL_RAW = process.env.FRESHWAY_LIVE_BASE_URL || 'https://fwcoldpressed.in';
const LIVE_BASE_URL = LIVE_BASE_URL_RAW.endsWith('/') ? LIVE_BASE_URL_RAW.slice(0, -1) : LIVE_BASE_URL_RAW;

test('LIVE Owner entry is usable on mobile and desktop without performing mutations', async ({ page }) => {
  test.setTimeout(90000);

  const pageErrors = [];
  const badAssets = [];
  const blockedWrites = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const request = response.request();
    const type = request.resourceType();
    const sameOrigin = new URL(response.url()).origin === new URL(LIVE_BASE_URL).origin;
    if (sameOrigin && ['script', 'stylesheet', 'image'].includes(type) && response.status() >= 400) {
      badAssets.push({ url: response.url(), status: response.status(), type });
    }
  });

  // Production protection: every non-GET API request is blocked at the browser boundary.
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method().toUpperCase() !== 'GET') {
      blockedWrites.push({ method: request.method(), url: request.url() });
      await route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Mutation blocked by read-only live Owner test.' })
      });
      return;
    }
    await route.continue();
  });

  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1365, height: 900 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.goto(LIVE_BASE_URL + '/admin/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    expect(response, viewport.name + ' Owner route must return a response').not.toBeNull();
    expect(response.status(), viewport.name + ' Owner route must return HTTP 200').toBe(200);
    expect(new URL(page.url()).pathname, viewport.name + ' Owner route must use the scoped /admin/ path').toBe('/admin/');

    await expect(page.locator('#loginView')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.locator('#adminToken')).toBeVisible();
    await expect(page.locator('#appView')).toHaveClass(/hidden/);

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      loginCardWidth: document.querySelector('.login-card')?.getBoundingClientRect().width || 0
    }));
    expect(layout.documentWidth, viewport.name + ' Owner login must not overflow horizontally').toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.loginCardWidth, viewport.name + ' Owner login card must fit the viewport').toBeLessThanOrEqual(layout.viewportWidth);

    // Empty-token validation must be client-side and must not call the login API.
    await page.locator('#connectBtn').click();
    await expect(page.locator('#toast')).toContainText('Enter the Worker ADMIN_TOKEN');
  }

  expect(blockedWrites, 'the live Owner read-only test must not issue API writes').toEqual([]);
  expect(badAssets, 'all same-origin Owner scripts, styles and images must load').toEqual([]);
  expect(pageErrors, 'the live Owner entry must not throw uncaught browser errors').toEqual([]);
});
