import { test, expect } from '@playwright/test';

const PREVIEW_BASE_URL = String(process.env.FRESHWAY_PREVIEW_BASE_URL || '').replace(/\\/$/, '');
const PREVIEW_WORKER_URL = String(process.env.FRESHWAY_PREVIEW_WORKER_URL || '').replace(/\\/$/, '');

test.skip(!PREVIEW_BASE_URL || !PREVIEW_WORKER_URL, 'Run only after the isolated Preview Worker and Pages binding are configured.');

test('Owner Preview opens directly to Home, loads real D1 reads, and keeps the service key server-side', async ({ page }) => {
  test.setTimeout(90000);

  const pageErrors = [];
  const adminApiResponses = [];
  const unexpectedWrites = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== PREVIEW_BASE_URL || !url.pathname.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method().toUpperCase()) &&
        url.pathname !== '/api/admin/orders/__owner_preview_readonly_probe__') {
      unexpectedWrites.push({ method: request.method(), path: url.pathname });
    }
  });
  page.on('response', response => {
    const request = response.request();
    const url = new URL(response.url());
    if (url.origin === PREVIEW_BASE_URL && url.pathname.startsWith('/api/admin/') && request.method() === 'GET') {
      adminApiResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1365, height: 900 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.goto(`${PREVIEW_BASE_URL}/admin/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    expect(response, `${viewport.name} Owner Preview must return a response`).not.toBeNull();
    expect(response.status(), `${viewport.name} Owner Preview route must return HTTP 200`).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/admin/');

    await expect(page.locator('#loginView')).toHaveClass(/hidden/);
    await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
    await expect(page.locator('#overview')).toHaveClass(/active/);
    await expect(page.locator('#overview h1')).toContainText('Good day');
    await expect(page.locator('#authState')).toContainText('Preview · test data');

    await expect.poll(
      () => adminApiResponses.some(item => item.path === '/api/admin/summary' && item.status === 200),
      { timeout: 20000, message: 'Owner Preview summary API must load successfully' }
    ).toBe(true);
    await expect.poll(
      () => adminApiResponses.some(item => item.path === '/api/admin/reports' && item.status === 200),
      { timeout: 20000, message: 'Owner Preview reports API must load successfully' }
    ).toBe(true);

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));
    expect(layout.documentWidth, `${viewport.name} Owner Home must not overflow horizontally`)
      .toBeLessThanOrEqual(layout.viewportWidth + 1);
  }

  // Pages injects the Preview-only service credential server-side. A browser
  // request made directly to workers.dev must not possess that credential.
  const directWorkerProbe = await page.evaluate(async workerUrl => {
    const response = await fetch(workerUrl + '/api/admin/summary', {
      method: 'GET',
      credentials: 'omit'
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, PREVIEW_WORKER_URL);
  expect(directWorkerProbe.status, 'Direct browser requests to the Preview Worker must not bypass Owner authentication').toBe(401);
  expect(directWorkerProbe.body.error).toBe('Unauthorized');

  expect(unexpectedWrites, 'Owner home must not issue API writes during page load').toEqual([]);
  expect(pageErrors, 'Owner Preview must not throw uncaught browser errors').toEqual([]);
});
