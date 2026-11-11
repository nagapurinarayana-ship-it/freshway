import { test, expect } from '@playwright/test';

const categoryPages = [
  {
    path: '/cold-pressed-oils.html',
    title: 'Cold-Pressed Oils | FreshWay',
    heading: 'Cold-Pressed Oils',
    canonical: 'https://fwcoldpressed.in/cold-pressed-oils.html'
  },
  {
    path: '/rice.html',
    title: 'Rice Varieties Online | FreshWay',
    heading: 'Rice Varieties',
    canonical: 'https://fwcoldpressed.in/rice.html'
  }
];

test.describe('FreshWay public SEO pages', () => {
  test('homepage exposes consistent, indexable metadata and links to both category pages', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle('FreshWay | Cold-Pressed Oils & Rice Delivered Locally');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-IN');
    await expect(page.locator('#homeView h1')).toContainText('Cold-pressed oils & rice');

    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'Shop cold-pressed oils and rice varieties with FreshWay. Browse the current catalogue, check product sizes and prices, and place a local delivery order with cash payment.'
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index,follow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://fwcoldpressed.in/');

    await expect(page.locator('.seo-category-links')).toHaveCount(0);

    const schema = await page.locator('#freshway-seo-schema').evaluate(element => JSON.parse(element.textContent));
    const graph = schema['@graph'];
    expect(graph.some(node => node['@type'] === 'Organization' && node.name === 'FreshWay')).toBe(true);
    expect(graph.some(node => node['@type'] === 'WebSite')).toBe(true);
    const homePage = graph.find(node => node['@type'] === 'WebPage');
    expect(homePage?.name).toBe('FreshWay | Cold-Pressed Oils & Rice Delivered Locally');
    expect(homePage?.description).toContain('cold-pressed oils and rice');
  });

  for (const category of categoryPages) {
    test(`${category.heading} page is independently crawlable and has valid structured data`, async ({ page }) => {
      const response = await page.goto(category.path);
      expect(response?.status()).toBe(200);

      await expect(page).toHaveTitle(category.title);
      await expect(page.locator('h1')).toHaveText(category.heading);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-IN');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index,follow/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', category.canonical);
      await expect(page.getByRole('link', { name: 'Browse the live FreshWay catalogue' })).toHaveAttribute('href', '/');

      const schema = await page.locator('#freshway-category-schema').evaluate(element => JSON.parse(element.textContent));
      const graph = schema['@graph'];
      const collectionPage = graph.find(node => node['@type'] === 'CollectionPage');
      const breadcrumb = graph.find(node => node['@type'] === 'BreadcrumbList');
      expect(collectionPage?.url).toBe(category.canonical);
      expect(collectionPage?.name).toBe(category.title);
      expect(breadcrumb?.itemListElement).toHaveLength(2);
      expect(breadcrumb?.itemListElement[0]?.item).toBe('https://fwcoldpressed.in/');
    });
  }

  test('sitemap lists only the three public canonical pages', async ({ page }) => {
    const response = await page.request.get('http://127.0.0.1:4173/sitemap.xml');
    expect(response.status()).toBe(200);
    const xml = await response.text();
    const urls = await page.evaluate(source => {
      const document = new DOMParser().parseFromString(source, 'application/xml');
      if (document.querySelector('parsererror')) throw new Error('Sitemap is not valid XML');
      return Array.from(document.getElementsByTagName('loc'), node => node.textContent);
    }, xml);

    expect(urls).toEqual([
      'https://fwcoldpressed.in/',
      'https://fwcoldpressed.in/cold-pressed-oils.html',
      'https://fwcoldpressed.in/rice.html'
    ]);
    expect(xml).not.toContain('#cart');
    expect(xml).not.toContain('/admin');
    expect(xml).toContain('<lastmod>2026-11-08</lastmod>');
  });

  test('robots.txt advertises the sitemap and keeps private API/admin paths out of crawl discovery', async ({ page }) => {
    const response = await page.request.get('http://127.0.0.1:4173/robots.txt');
    expect(response.status()).toBe(200);
    const robots = await response.text();

    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /admin.html');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Sitemap: https://fwcoldpressed.in/sitemap.xml');
  });
});
