import { test, expect } from '@playwright/test';

const PREVIEW_BASE_URL = 'https://test-expand-playwright-cover.freshway-f32.pages.dev';

test('Owner Preview opens directly to Home, loads read-only Admin data, and blocks writes', async ({ page }) => {
  test.setTimeout(90000);

  const pageErrors = [];
  const adminApiResponses = [];
  const unexpectedWrites = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== PREVIEW_BASE_URL || !url.pathname.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method().toUpperCase())) {
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
    await expect(page.locator('#authState')).toContainText('Preview · read-only');

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

  // This synthetic ID does not exist. The Preview Worker must reject the request
  // before any order handler or database mutation can run.
  const writeProbe = await page.evaluate(async () => {
    const response = await fetch('/api/admin/orders/__owner_preview_readonly_probe__', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Delivered' })
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
  expect(writeProbe.status, 'Preview Admin writes must be blocked by the Worker').toBe(405);
  expect(writeProbe.body.error).toContain('read-only');

  expect(unexpectedWrites, 'Owner home must not issue API writes during page load').toEqual([]);
  expect(pageErrors, 'Owner Preview must not throw uncaught browser errors').toEqual([]);
});
