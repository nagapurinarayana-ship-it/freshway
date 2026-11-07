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


test('customer page Back buttons honour explicit destinations on deep links and after refresh', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });

  // A direct checkout route has no trustworthy in-app predecessor. Its own
  // Back control must still go to Cart rather than replaying the same entry.
  await page.goto('/?nav-back-deep=1#checkout');
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await expect.poll(() => page.evaluate(() => history.state?.view)).toBe('checkout');
  await page.locator('#checkoutView .back-btn').click();
  await expect(page.locator('#cartView')).toHaveClass(/active-view/);
  await expect.poll(() => page.evaluate(() => history.state?.view)).toBe('cart');
  // Browser Back after the explicit fallback must leave this deep-linked app
  // entry; it must not reopen a duplicated, stale Checkout history item.
  await page.goBack();
  await expect(page).toHaveURL('about:blank');

  // A directly restored Cart entry has the same rule after refresh.
  await page.goto('/?nav-back-refresh=1#cart');
  await expect(page.locator('#cartView')).toHaveClass(/active-view/);
  await page.reload();
  await expect(page.locator('#cartView')).toHaveClass(/active-view/);
  await page.locator('#cartView .back-btn').click();
  await expect(page.locator('#homeView')).toHaveClass(/active-view/);
  await expect.poll(() => page.evaluate(() => history.state?.view)).toBe('home');
  await page.goBack();
  await expect(page).toHaveURL('about:blank');

  // When a real in-app predecessor exists, the control should use that history
  // entry, preserving normal browser Forward behaviour instead of replacing it.
  await page.goto('/?nav-back-sequence=1');
  await page.locator('.bottom-nav [data-nav="cart"]').click();
  await expect(page.locator('#cartView')).toHaveClass(/active-view/);
  await page.evaluate(() => window.setView('checkout'));
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await expect.poll(() => page.evaluate(() => history.state?.previousView)).toBe('cart');
  await page.locator('#checkoutView .back-btn').click();
  await expect(page.locator('#cartView')).toHaveClass(/active-view/);
  await page.goBack();
  await expect(page.locator('#homeView')).toHaveClass(/active-view/);
  await page.goForward();
  await expect(page.locator('#cartView')).toHaveClass(/active-view/);

  expect(pageErrors).toEqual([]);
});
