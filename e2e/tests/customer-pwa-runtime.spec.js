import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('customer PWA installs its service worker and restores the app shell while offline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('.hero-banner h1')).toBeVisible();

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: ready.scope,
      scriptURL: ready.active?.scriptURL || '',
      controller: Boolean(navigator.serviceWorker.controller),
      cachedHome: Boolean(await (await caches.open('freshway-v113')).match('/'))
    };
  });

  expect(registration.scope).toContain('/');
  expect(registration.scriptURL).toContain('/sw.js');
  expect(registration.cachedHome).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('.hero-banner h1')).toBeVisible();
  await expect(page.locator('.brand-logo')).toBeVisible();
});
