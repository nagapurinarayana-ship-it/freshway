import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// This is a deterministic visual fixture. Catalogue art comes from the real
// checked-in asset map; promotion data is synthetic and does not represent a
// live Owner-configured promotion or production catalogue prices.
const products = [
  { id: 'p-1788808795819-x0yy', name: 'Organic Groundnut Oil', unit: '5 ltr', price: 1850, active: 1, category_id: 'cat-oils', category_name: 'Oils', category_slug: 'oils' },
  { id: 'p-mtsy8sib-wdsit', name: 'Organic Sunflower Oil', unit: 'ltr', price: 100, active: 1, category_id: 'cat-oils', category_name: 'Oils', category_slug: 'oils' },
  { id: 'p-mtsy9yvt-ca3c5', name: 'HMT Rice', unit: 'kg', price: 80, active: 1, category_id: 'cat-rice', category_name: 'Rice', category_slug: 'rice' },
  { id: 'p-mtsyafsh-82by2', name: 'Sona Masuri Rice', unit: 'kg', price: 75, active: 1, category_id: 'cat-rice', category_name: 'Rice', category_slug: 'rice' }
];

const categories = [
  { id: 'cat-oils', name: 'Oils', slug: 'oils', icon: '🫒', description: 'Cold-pressed and everyday oils', product_count: 2, display_order: 1 },
  { id: 'cat-rice', name: 'Rice', slug: 'rice', icon: '🍚', description: 'Rice and rice varieties', product_count: 2, display_order: 2 }
];

const promoSvg = (headline, accent) => Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="525" viewBox="0 0 1200 525">' +
  '<rect width="1200" height="525" fill="#f1f7f3"/>' +
  '<circle cx="1010" cy="95" r="220" fill="' + accent + '" opacity=".18"/>' +
  '<circle cx="1080" cy="470" r="210" fill="' + accent + '" opacity=".13"/>' +
  '<rect x="62" y="65" width="7" height="395" rx="3" fill="' + accent + '"/>' +
  '<text x="105" y="135" font-family="Arial,sans-serif" font-size="32" font-weight="700" fill="#147447">FRESHWAY · VISUAL TEST FIXTURE</text>' +
  '<text x="105" y="245" font-family="Arial,sans-serif" font-size="68" font-weight="700" fill="#18372a">' + headline + '</text>' +
  '<text x="105" y="315" font-family="Arial,sans-serif" font-size="30" fill="#496556">Synthetic E2E artwork — not a live promotion</text>' +
  '<rect x="105" y="365" width="250" height="60" rx="18" fill="' + accent + '"/>' +
  '<text x="230" y="404" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#ffffff">IMAGE LOAD CHECK</text>' +
  '</svg>'
).toString('base64');

const promotions = [
  { id: 'visual-promo-1', title: 'Fresh picks for every day', alt_text: 'E2E promotion image fixture — not a live offer', image_mime_type: 'image/svg+xml', image_data: promoSvg('Fresh picks for every day', '#147447'), display_order: 1, active: 1 },
  { id: 'visual-promo-2', title: 'Everyday essentials', alt_text: 'E2E promotion image fixture — not a live offer', image_mime_type: 'image/svg+xml', image_data: promoSvg('Everyday essentials', '#b47b24'), display_order: 2, active: 1 }
];

test('customer visual review: bundled category and product art plus decoded promotion images', async ({ page }) => {
  await mkdir('test-results/visual-review', { recursive: true });

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/categories') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories }) });
    }
    if (method === 'GET' && url.pathname === '/api/products') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products }) });
    }
    if (method === 'GET' && url.pathname === '/api/promotions') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ promotions }) });
    }
    if (method === 'GET' && url.pathname === '/api/auth/session') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customerId: 'visual-review-customer' }) });
    }
    if (method === 'GET' && url.pathname === '/api/orders') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [] }) });
    }

    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Endpoint not configured in visual-review fixture.' }) });
  });

  const decoded = async locator => {
    await expect.poll(() => locator.evaluateAll(images =>
      images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
    )).toBe(true);
  };

  const capture = async name => {
    await page.screenshot({
      path: 'test-results/visual-review/' + name + '.png',
      fullPage: false,
      animations: 'disabled'
    });
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const semanticMedia = await page.evaluate(() => ({
    categoryWithChangedId: window.FreshWayCatalogueMedia.image('categories', 'category-renamed-oils', { name: 'Cooking Oils', slug: 'cooking-oils' }),
    riceCategoryWithChangedId: window.FreshWayCatalogueMedia.image('categories', 'category-renamed-rice', { name: 'Rice', slug: 'rice' }),
    groundnutWithChangedId: window.FreshWayCatalogueMedia.image('products', 'product-renamed-groundnut', { name: 'Ground nut oil / 5 ltrs' }),
    sunflowerWithChangedId: window.FreshWayCatalogueMedia.image('products', 'product-renamed-sunflower', { name: 'Organic Sunflower Oil' }),
    hmtWithChangedId: window.FreshWayCatalogueMedia.image('products', 'product-renamed-hmt', { name: 'HMT Rice' }),
    sonaWithChangedId: window.FreshWayCatalogueMedia.image('products', 'product-renamed-sona', { name: 'Sona Masuri Rice' }),
    unknownProduct: window.FreshWayCatalogueMedia.image('products', 'unmapped-product', { name: 'Unmapped Product' })
  }));
  expect(semanticMedia).toEqual({
    categoryWithChangedId: 'frontend/media/catalogue/groundnut-oil.svg',
    riceCategoryWithChangedId: 'frontend/media/catalogue/hmt-rice.svg',
    groundnutWithChangedId: 'frontend/media/catalogue/groundnut-oil.svg',
    sunflowerWithChangedId: 'frontend/media/catalogue/sunflower-oil.svg',
    hmtWithChangedId: 'frontend/media/catalogue/hmt-rice.svg',
    sonaWithChangedId: 'frontend/media/catalogue/sona-masuri.svg',
    unknownProduct: ''
  });
  await expect.poll(() => page.locator('.hero-banner .fw-promo-slide img').count()).toBe(2);
  await decoded(page.locator('.hero-banner .fw-promo-slide img'));

  const mobileCategoryImages = page.locator('#fwCategoryCatalogue .fw-category-image img');
  await expect(mobileCategoryImages).toHaveCount(2);
  await mobileCategoryImages.first().scrollIntoViewIfNeeded();
  await decoded(mobileCategoryImages);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('mobile-home-media-fixture');

  await page.locator('[data-fw-category="cat-oils"]').click();
  const oilImages = page.locator('#productGrid .product-card:visible .product-image img');
  await expect(page.locator('#productGrid .product-card:visible')).toHaveCount(2);
  await expect(oilImages).toHaveCount(2);
  await oilImages.first().scrollIntoViewIfNeeded();
  await decoded(oilImages);
  await capture('mobile-products-media-fixture');

  await page.setViewportSize({ width: 1365, height: 900 });
  // Reload at the new viewport so session category selection cannot leak into the desktop capture.
  await page.reload();
  await expect(page.locator('.hero-banner .fw-promo-slide img')).toHaveCount(2);
  await decoded(page.locator('.hero-banner .fw-promo-slide img'));
  const desktopCategoryImages = page.locator('#fwCategoryCatalogue .fw-category-image img');
  await expect(desktopCategoryImages).toHaveCount(2);
  await desktopCategoryImages.first().scrollIntoViewIfNeeded();
  await decoded(desktopCategoryImages);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('desktop-home-media-fixture');

  await page.locator('[data-fw-category="cat-rice"]').click();
  const riceImages = page.locator('#productGrid .product-card:visible .product-image img');
  await expect(page.locator('#productGrid .product-card:visible')).toHaveCount(2);
  await expect(riceImages).toHaveCount(2);
  await riceImages.first().scrollIntoViewIfNeeded();
  await decoded(riceImages);
  await capture('desktop-products-media-fixture');
});
