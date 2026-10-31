import { test, expect } from '@playwright/test';

test('FreshWay customer storefront renders on mobile and desktop in this browser engine', async ({ page }) => {
  const pageErrors = [];
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Write blocked in browser compatibility test.' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({})
    });
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('.hero-banner h1')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeVisible();

  await page.setViewportSize({ width: 1365, height: 900 });
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#main-content')).toBeVisible();

  expect(pageErrors, 'storefront should not throw uncaught browser errors').toEqual([]);
});
