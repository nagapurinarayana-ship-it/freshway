import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const LIVE_BASE_URL = (process.env.FRESHWAY_LIVE_BASE_URL || 'https://fwcoldpressed.in').replace(/\/$/, '');
const OUTPUT_DIR = 'test-results/visual-review';

async function getJson(request, path) {
  const response = await request.get(LIVE_BASE_URL + path, { timeout: 20000 });
  expect(response.status(), path + ' must return HTTP 200').toBe(200);
  expect((response.headers()['content-type'] || '').toLowerCase(), path + ' must return JSON').toContain('application/json');
  return response.json();
}

async function expectDecodedImages(locator, description) {
  const count = await locator.count();
  if (!count) return;
  await expect.poll(async () => locator.evaluateAll(images =>
    images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
  ), { timeout: 20000, message: description + ' must all decode to non-empty images' }).toBe(true);
}

test('LIVE production media audit: real catalogue, category artwork and configured promotions', async ({ page, request }) => {
  test.setTimeout(150000);
  await mkdir(OUTPUT_DIR, { recursive: true });

  // These are read-only public GETs against the currently deployed site.
  const [categoryData, productData, promotionData] = await Promise.all([
    getJson(request, '/api/categories'),
    getJson(request, '/api/products'),
    getJson(request, '/api/promotions')
  ]);

  const categories = Array.isArray(categoryData?.categories) ? categoryData.categories : [];
  const products = Array.isArray(productData?.products) ? productData.products : [];
  const promotions = Array.isArray(promotionData?.promotions) ? promotionData.promotions : [];
  expect(categories.length, 'production should expose at least one category with active products').toBeGreaterThan(0);
  expect(products.length, 'production should expose at least one active catalogue product').toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Verify install guidance remains available only on demand and never blocks browsing.
  await page.waitForTimeout(3500);
  await expect(page.locator('.pwa-help'), 'install help must not interrupt first-time browsing').toHaveCount(0);
  await expect(page.locator('#fwCategoryCatalogue .fw-category-card').first()).toBeVisible({ timeout: 25000 });

  const sourceAudit = await page.evaluate(({ categories, products, promotions }) => {
    const media = window.FreshWayCatalogueMedia;
    const hasUploadedImage = item => Boolean(item?.image_data && item?.image_mime_type);
    const categoryRows = categories.map(item => {
      const uploaded = hasUploadedImage(item);
      const mapped = !uploaded && Boolean(media?.image('categories', item.id, item));
      return { id: String(item.id), name: String(item.name || ''), source: uploaded ? 'owner-uploaded' : mapped ? 'bundled-art' : 'emoji-fallback' };
    });
    const productRows = products.map(item => {
      const uploaded = hasUploadedImage(item);
      const mapped = !uploaded && Boolean(media?.image('products', item.id, item));
      return {
        id: String(item.id),
        name: String(item.name || ''),
        category: String(item.category_name || item.category_slug || item.category_id || ''),
        source: uploaded ? 'owner-uploaded' : mapped ? 'bundled-art' : 'emoji-fallback'
      };
    });
    const promotionRows = promotions.map(item => ({
      id: String(item.id),
      alt: String(item.alt_text || ''),
      hasImageData: Boolean(item.image_data),
      mime: String(item.image_mime_type || '')
    }));
    return { categoryRows, productRows, promotionRows };
  }, { categories, products, promotions });

  const validPromotions = promotions.filter(item => item?.image_data && item?.image_mime_type);
  const badPromotionRows = promotions.filter(item => !item?.image_data || !item?.image_mime_type);
  const fallbackCategories = sourceAudit.categoryRows.filter(item => item.source === 'emoji-fallback');
  const fallbackProducts = sourceAudit.productRows.filter(item => item.source === 'emoji-fallback');

  await expectDecodedImages(page.locator('#fwCategoryCatalogue .fw-category-image img'), 'production category artwork');

  const promotionImages = page.locator('.hero-banner .fw-promo-slide img');
  if (validPromotions.length) {
    await expect.poll(() => promotionImages.count(), { timeout: 20000 }).toBe(validPromotions.length);
    await expectDecodedImages(promotionImages, 'production promotion images');
    await expect.poll(() => page.locator('[data-fw-promo-dot]').count(), { timeout: 10000 }).toBe(validPromotions.length);
    for (let i = 0; i < validPromotions.length; i++) {
      await page.locator('[data-fw-promo-dot]').nth(i).click();
      const activePromotion = page.locator('.hero-banner .fw-promo-slide[aria-hidden="false"] img');
      await expect(activePromotion).toBeVisible();
      await expect.poll(() => activePromotion.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0), {
        timeout: 10000,
        message: 'Production promotion slide ' + (i + 1) + ' must decode'
      }).toBe(true);
      await page.locator('.hero-banner').screenshot({
        path: OUTPUT_DIR + '/live-production-promotion-' + (i + 1) + '.png',
        animations: 'disabled'
      });
    }
  } else {
    await expect(page.locator('.hero-banner h1')).toBeVisible();
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: OUTPUT_DIR + '/live-production-mobile-home.png', fullPage: true, animations: 'disabled' });

  // Use the actual live category control and actual API data; do not stub or seed this page.
  const categoryButtons = page.locator('#fwCategoryCatalogue .fw-category-card');
  await categoryButtons.first().click();
  const visibleCards = page.locator('#productGrid .product-card:visible');
  await expect.poll(() => visibleCards.count(), { timeout: 20000 }).toBeGreaterThan(0);
  const productImages = visibleCards.locator('.product-image img');
  const visibleImageCount = await productImages.count();
  for (let i = 0; i < visibleImageCount; i++) {
    const image = productImages.nth(i);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0), {
      timeout: 15000,
      message: 'Production product image failed to decode: ' + await image.getAttribute('alt')
    }).toBe(true);
  }
  await page.screenshot({ path: OUTPUT_DIR + '/live-production-mobile-products.png', fullPage: true, animations: 'disabled' });

  // Re-capture at desktop width to catch responsive rendering differences.
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Verify install guidance remains available only on demand and never blocks browsing.
  await page.waitForTimeout(3500);
  await expect(page.locator('.pwa-help'), 'install help must not interrupt first-time browsing').toHaveCount(0);
  await expect(page.locator('#fwCategoryCatalogue .fw-category-card').first()).toBeVisible({ timeout: 25000 });
  await expectDecodedImages(page.locator('#fwCategoryCatalogue .fw-category-image img'), 'desktop production category artwork');
  const desktopPromotions = page.locator('.hero-banner .fw-promo-slide img');
  if (validPromotions.length) {
    await expect.poll(() => desktopPromotions.count(), { timeout: 20000 }).toBe(validPromotions.length);
    await expectDecodedImages(desktopPromotions, 'desktop production promotion images');
  } else {
    await expect(page.locator('.hero-banner h1')).toBeVisible();
  }
  await page.screenshot({ path: OUTPUT_DIR + '/live-production-desktop-home.png', fullPage: true, animations: 'disabled' });
  await page.locator('#fwCategoryCatalogue .fw-category-card').first().click();
  const desktopCards = page.locator('#productGrid .product-card:visible');
  await expect.poll(() => desktopCards.count(), { timeout: 20000 }).toBeGreaterThan(0);
  const desktopImageCount = await desktopCards.locator('.product-image img').count();
  for (let i = 0; i < desktopImageCount; i++) {
    const image = desktopCards.locator('.product-image img').nth(i);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0), {
      timeout: 15000,
      message: 'Desktop production product image failed to decode: ' + await image.getAttribute('alt')
    }).toBe(true);
  }
  await page.screenshot({ path: OUTPUT_DIR + '/live-production-desktop-products.png', fullPage: true, animations: 'disabled' });

  const report = {
    baseUrl: LIVE_BASE_URL,
    source: 'real deployed website and read-only public APIs; no API mocking or database writes',
    categories: categories.length,
    activeProducts: products.length,
    activePromotionRows: promotions.length,
    usablePromotionImages: validPromotions.length,
    promotionsMissingImageFields: badPromotionRows.map(item => String(item.id || 'unknown')),
    categoryArtwork: {
      ownerUploaded: sourceAudit.categoryRows.filter(item => item.source === 'owner-uploaded').length,
      bundled: sourceAudit.categoryRows.filter(item => item.source === 'bundled-art').length,
      emojiFallback: fallbackCategories
    },
    productArtwork: {
      ownerUploaded: sourceAudit.productRows.filter(item => item.source === 'owner-uploaded').length,
      bundled: sourceAudit.productRows.filter(item => item.source === 'bundled-art').length,
      emojiFallback: fallbackProducts
    },
    promotionArtwork: sourceAudit.promotionRows.map(({ id, alt, hasImageData, mime }) => ({ id, alt, hasImageData, mime })),
    missingPromotionAltText: sourceAudit.promotionRows.filter(item => !item.alt.trim()).map(item => item.id),
    repeatedPromotionAltText: [...new Set(sourceAudit.promotionRows.map(item => item.alt.trim()).filter(Boolean).filter((alt, i, all) => all.indexOf(alt) !== i))],
    pageErrors
  };
  await writeFile(OUTPUT_DIR + '/live-production-media-audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log('FRESHWAY_LIVE_MEDIA_AUDIT ' + JSON.stringify(report));

  expect(badPromotionRows, 'active promotions should never be published without image data and a MIME type').toEqual([]);
  expect(pageErrors, 'live customer page should not produce uncaught JavaScript errors').toEqual([]);
});
