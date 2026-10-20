import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL || 'https://freshway-f32.pages.dev';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', ...options });
      if (response.ok || response.status === 304) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(5000);
  }
  throw lastError;
}

function assertCurrentScriptReference(html, pageUrl, expectedPath, label) {
  const expected = new URL(expectedPath, pageUrl);
  const references = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(([, src]) => new URL(src, pageUrl))
    .filter(url => url.pathname === expected.pathname);

  assert.equal(
    references.length,
    1,
    `${label} must reference ${expected.pathname} exactly once`
  );
  assert.equal(
    references[0].search,
    expected.search,
    `${label} must reference the current version of ${expected.pathname}`
  );
}

async function waitForFullImageFitAssets(base) {
  const promotionPath = '/frontend/customer/promotions.js?v=20261009-full-image-fit-v1';
  const cataloguePath = '/frontend/admin/catalogue.js?v=20261009-full-image-fit-v1';
  let lastError;

  // Static deployments can lag the main-branch push; retry stale 200 responses too.
  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      const probe = `__freshway_deploy_probe=${Date.now()}-${attempt}`;
      const [indexResponse, adminResponse, swResponse] = await Promise.all([
        fetch(`${base}/?${probe}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}/admin.html?${probe}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}/sw.js?${probe}`, { cache: 'no-store', redirect: 'follow' })
      ]);
      for (const [label, response] of [['home', indexResponse], ['Owner', adminResponse], ['service worker', swResponse]]) {
        assert.equal(response.status, 200, `production ${label} returned HTTP ${response.status}`);
      }

      for (const [label, response] of [['home', indexResponse], ['Owner', adminResponse], ['service worker', swResponse]]) {
        assert.match(
          response.headers.get('cache-control') || '',
          /no-store|no-cache/i,
          `production ${label} must not reuse stale app shell responses`
        );
      }

      const [indexHtml, adminHtml, sw] = await Promise.all([
        indexResponse.text(), adminResponse.text(), swResponse.text()
      ]);
      assertCurrentScriptReference(indexHtml, indexResponse.url, promotionPath, 'production home');
      assertCurrentScriptReference(adminHtml, adminResponse.url, cataloguePath, 'production Owner');
      assert.ok(sw.includes(promotionPath), 'service worker does not cache the current promotion script');

      const [promotionResponse, catalogueResponse] = await Promise.all([
        fetch(`${base}${promotionPath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${cataloguePath}`, { cache: 'no-store', redirect: 'follow' })
      ]);
      assert.equal(promotionResponse.status, 200, 'current customer promotion script must load');
      assert.equal(catalogueResponse.status, 200, 'current Owner catalogue script must load');

      const [promotionSource, catalogueSource] = await Promise.all([
        promotionResponse.text(), catalogueResponse.text()
      ]);
      assert.match(promotionSource, /\.fw-promo-carousel\{[^}]*height:auto;aspect-ratio:16\/7/);
      assert.match(promotionSource, /object-fit:contain/);
      assert.match(catalogueSource, /\.fw-promo-preview\{[^}]*height:auto;min-height:0;aspect-ratio:auto/);
      assert.match(catalogueSource, /\.fw-promo-preview img\{[^}]*max-width:100%;max-height:320px;width:auto;height:auto;object-fit:contain/);
      assert.match(catalogueSource, /\.fw-product-icon\{height:auto;min-height:100px;aspect-ratio:4\/3/);

      return { indexResponse, indexHtml, adminResponse, adminHtml, swResponse, sw };
    } catch (error) {
      lastError = error;
      if (attempt < 60) await sleep(5000);
    }
  }

  throw lastError;
}

const base = BASE_URL.replace(/\/$/, '');

const { indexResponse, indexHtml, adminResponse, adminHtml, swResponse, sw } =
  await waitForFullImageFitAssets(base);
assert.equal(new URL(indexResponse.url).pathname, '/');
assert.equal(indexResponse.status, 200);
assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);

const manifestResponse = await fetchWithRetry(`${base}/manifest.webmanifest`);
const finalManifestUrl = new URL(manifestResponse.url);
assert.equal(finalManifestUrl.pathname, '/manifest.webmanifest');
assert.ok(
  [new URL(base).origin, new URL(process.env.CUSTOM_DOMAIN_URL || 'https://fwcoldpressed.in').origin].includes(finalManifestUrl.origin),
  'manifest must remain on the Pages host or the configured production custom domain'
);
assert.equal(manifestResponse.status, 200);
assert.match(
  manifestResponse.headers.get('content-type') || '',
  /application\/manifest\+json/i,
  'manifest must be served as application/manifest+json'
);

const manifest = await manifestResponse.json();
assert.equal(manifest.name, 'FreshWay');
assert.equal(manifest.short_name, 'FreshWay');
assert.equal(manifest.id, '/freshway');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
for (const size of ['192x192', '512x512']) {
  assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.type === 'image/png'));
}

for (const path of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-192-maskable.png', '/icons/icon-512-maskable.png']) {
  const response = await fetchWithRetry(`${base}${path}`);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') || '', /^image\/png/i, path);
  assert.ok((await response.arrayBuffer()).byteLength > 100, path);
}

const logoResponse = await fetchWithRetry(`${base}/freshway-logo-master.webp?v=20261008-master-v1`);
assert.equal(logoResponse.status, 200);
assert.match(logoResponse.headers.get('content-type') || '', /^image\/webp/i, 'master FreshWay logo must be served as WebP');
assert.ok((await logoResponse.arrayBuffer()).byteLength > 100, 'master FreshWay logo must contain image data');

assert.equal(new URL(adminResponse.url).pathname, '/admin.html');
assert.equal(adminResponse.status, 200);
assert.match(swResponse.headers.get('content-type') || '', /javascript/i, 'service worker must be JavaScript');
assert.equal(swResponse.headers.get('service-worker-allowed'), '/', 'service worker must explicitly allow root scope');
assert.match(sw, /const CACHE = 'freshway-v\d+'/);
assert.match(sw, /const REQUIRED_SHELL = \[\s*'\/',\s*'\/index\.html'\s*\]/);


async function verifyCustomDomain() {
  const customBase = (process.env.CUSTOM_DOMAIN_URL || 'https://fwcoldpressed.in').replace(/\/$/, '');
  const probe = `__freshway_custom_domain_probe=${Date.now()}`;
  const [homeResponse, adminResponse, swResponse] = await Promise.all([
    fetchWithRetry(`${customBase}/?${probe}`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/admin.html?${probe}`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/sw.js?${probe}`, { cache: 'no-store' })
  ]);

  for (const [label, response] of [['custom-domain home', homeResponse], ['custom-domain Owner', adminResponse], ['custom-domain service worker', swResponse]]) {
    assert.equal(response.status, 200, `${label} must return HTTP 200`);
    assert.match(response.headers.get('cache-control') || '', /no-store|no-cache/i, `${label} must not reuse a stale app shell`);
  }

  const [homeHtml, adminHtml, sw] = await Promise.all([
    homeResponse.text(), adminResponse.text(), swResponse.text()
  ]);
  assert.equal(new URL(homeResponse.url).origin, customBase, 'home must remain on the custom domain');
  assert.match(homeHtml, /<link rel="canonical" href="https:\/\/fwcoldpressed\.in\/">/, 'custom-domain canonical URL must use the production domain');
  assert.match(homeHtml, /property="og:url" content="https:\/\/fwcoldpressed\.in\//, 'Open Graph URL must use the production domain');
  assert.match(homeHtml, /property="og:image" content="https:\/\/fwcoldpressed\.in\/freshway-whatsapp-share\.png\?v=[^"]+"/, 'WhatsApp share image must use the versioned custom-domain image');
  assert.match(homeHtml, /name="twitter:image" content="https:\/\/fwcoldpressed\.in\/freshway-whatsapp-share\.png\?v=[^"]+"/, 'Twitter share image must use the same versioned custom-domain image');
  assertCurrentScriptReference(homeHtml, homeResponse.url, '/frontend/customer/promotions.js?v=20261009-full-image-fit-v1', 'custom-domain home');
  assertCurrentScriptReference(adminHtml, adminResponse.url, '/frontend/admin/catalogue.js?v=20261009-full-image-fit-v1', 'custom-domain Owner');
  assert.ok(sw.includes('/frontend/customer/promotions.js?v=20261009-full-image-fit-v1'), 'custom-domain service worker must cache the current promotion script');

  const shareMatch = homeHtml.match(/property="og:image" content="([^"]+)"/);
  assert.ok(shareMatch, 'custom-domain Open Graph image URL must exist');
  const shareImageUrl = new URL(shareMatch[1], customBase);
  assert.equal(shareImageUrl.origin, customBase, 'share image must not point to a different host');
  const [shareImageResponse, healthResponse, productsResponse, categoriesResponse] = await Promise.all([
    fetchWithRetry(shareImageUrl.href, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/api/health`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/api/products`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/api/categories`, { cache: 'no-store' })
  ]);
  assert.match(shareImageResponse.headers.get('content-type') || '', /^image\/png/i, 'WhatsApp share image must be served as PNG');
  assert.ok((await shareImageResponse.arrayBuffer()).byteLength > 100, 'WhatsApp share image must contain image data');

  const health = await healthResponse.json();
  assert.equal(health.ok, true, 'custom-domain API health check must report ok');
  assert.equal(health.service, 'freshway-api', 'custom-domain API must reach the FreshWay Worker');
  const products = await productsResponse.json();
  const categories = await categoriesResponse.json();
  assert.ok(Array.isArray(products.products), 'custom-domain products API must return a products array');
  assert.ok(Array.isArray(categories.categories), 'custom-domain categories API must return a categories array');

  console.log('Custom production domain smoke OK');
  console.log(JSON.stringify({
    customBase,
    apiHealth: health,
    productsReturned: products.products.length,
    categoriesReturned: categories.categories.length,
    shareImage: shareImageUrl.pathname + shareImageUrl.search,
    homeCacheControl: homeResponse.headers.get('cache-control'),
    serviceWorkerCacheControl: swResponse.headers.get('cache-control')
  }, null, 2));
}

await verifyCustomDomain();

console.log('Live PWA smoke OK');
console.log(JSON.stringify({
  base,
  manifestContentType: manifestResponse.headers.get('content-type'),
  serviceWorkerContentType: swResponse.headers.get('content-type'),
  serviceWorkerAllowed: swResponse.headers.get('service-worker-allowed'),
  manifest: {
    id: manifest.id,
    start_url: manifest.start_url,
    scope: manifest.scope,
    display: manifest.display
  }
}, null, 2));
