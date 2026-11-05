import { test, expect } from '@playwright/test';

// Bounded, reproducible monkey run. It exercises only read/navigation surfaces:
// no checkout submission, OTP, sign-out, deletion, inventory or order mutations.
test('customer navigation monkey run survives random navigation, reload and history', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#homeView')).toHaveClass(/active-view/);

  // Fixed seed makes failures reproducible while varying the route sequence.
  let seed = 0x5eed2026;
  const random = max => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % max;
  };
  const routes = ['home', 'cart', 'orders', 'profile', 'about', 'contact'];
  const visited = new Set(['home']);

  async function verifyShell(label) {
    await expect(page.locator('.view.active-view'), label + ': exactly one active view').toHaveCount(1);
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      active: document.querySelector('.view.active-view')?.id || null
    }));
    expect(layout.document, label + ': no horizontal overflow').toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.active, label + ': active view exists').toBeTruthy();
  }

  for (let step = 0; step < 48; step++) {
    const route = routes[random(routes.length)];
    let nav = page.locator('[data-nav="' + route + '"]').first();

    // About and Contact are intentionally nested under Profile, not the
    // persistent bottom navigation. Open their parent before exercising them.
    if ((route === 'about' || route === 'contact') && !(await nav.isVisible().catch(() => false))) {
      const profileNav = page.locator('[data-nav="profile"]').first();
      if (await profileNav.isVisible().catch(() => false)) {
        await profileNav.click();
        await expect(page.locator('#profileView')).toHaveClass(/active-view/);
        nav = page.locator('[data-nav="' + route + '"]').first();
      }
    }

    if (await nav.isVisible().catch(() => false)) {
      await nav.click();
      await expect(page.locator('#' + route + 'View')).toHaveClass(/active-view/);
      visited.add(route);
    }

    if (step % 7 === 3) {
      await page.reload();
      await expect(page.locator('.view.active-view')).toBeVisible();
    }
    if (step % 11 === 5) {
      await page.goBack().catch(() => {});
      await page.waitForTimeout(80);
      await page.goForward().catch(() => {});
      await page.waitForTimeout(80);
    }
    if (step % 4 === 0) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await verifyShell('monkey step ' + step);
  }

  for (const route of routes) expect(visited.has(route), 'route exercised: ' + route).toBeTruthy();
  expect(pageErrors, 'no uncaught browser exceptions during monkey run').toEqual([]);
});
