import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL || 'https://freshway-f32.pages.dev';
const VIEWPORT_STYLES_PATH = '/styles.css?v=20261022-invoice-ui-v1';
const CUSTOMER_APP_PATH = '/app.js?v=20261021-home-navigation-refresh-v1';
const ADDRESS_GEOCODE_PATH = '/frontend/customer/address-geocode.js?v=20261021-guest-address-map-search-v3';
const ADDRESS_SYSTEM_PATH = '/address-system-final.js?v=20261021-guest-address-map-search-v3';
const EXPECTED_CUSTOMER_CACHE = 'freshway-v74';
const PWA_INSTALL_SCRIPT_PATH = '/frontend/customer/pwa-install.js?v=20261024-native-install-v2';
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

function assertVersionedCodeReferences(html, pageUrl, label) {
  const origin = new URL(pageUrl).origin;
  for (const [, tag] of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const isScript = tag.toLowerCase().startsWith('<script');
    const isStylesheet = tag.toLowerCase().startsWith('<link') && /\brel=["']stylesheet["']/i.test(tag);
    if (!isScript && !isStylesheet) continue;
    const attribute = isScript ? 'src' : 'href';
    const match = tag.match(isScript ? /\bsrc=["']([^"']+)["']/i : /\bhref=["']([^"']+)["']/i);
    if (!match) continue;
    const url = new URL(match[1], pageUrl);
    if (url.origin !== origin || !/\.(?:js|css)$/i.test(url.pathname)) continue;
    assert.ok(url.searchParams.get('v'), label + ' must version every local JS/CSS asset: ' + url.pathname);
  }
}

function assertImmutableCodeCache(response, label) {
  const cacheControl = response.headers.get('cache-control') || '';
  assert.match(cacheControl, /public/i, label + ' must be browser-cacheable');
  assert.match(cacheControl, /max-age=31536000/i, label + ' must use the versioned one-year cache lifetime');
  assert.match(cacheControl, /immutable/i, label + ' must declare immutable');
  assert.doesNotMatch(cacheControl, /no-store|no-cache/i, label + ' must not disable its cache');
}

function assertResponsiveViewportCss(css, label) {
  assert.match(css, /body\{padding-bottom:calc\(84px \+ env\(safe-area-inset-bottom,0px\)\)\}/, label + ' must reserve the device safe area');
  assert.match(css, /main\{padding:14px 16px calc\(98px \+ env\(safe-area-inset-bottom,0px\)\)\}/, label + ' must reserve scroll space below navigation');
  assert.match(css, /\.bottom-nav\{height:calc\(68px \+ env\(safe-area-inset-bottom,0px\)\)\}/, label + ' bottom navigation must respect the safe area');
  assert.match(css, /\.info-page\{display:grid;gap:10px;padding:2px 0 8px;min-width:0\}/, label + ' About/Contact pages must use the shared scroll reserve');
  assert.match(css, /\.store-contact-cta\{[^}]*min-height:48px/, label + ' contact action must remain compact and tappable');
}

function assertNativeInstallFlow(source, label) {
  assert.ok(source.includes('beforeinstallprompt'), label + ' must capture Chrome install availability');
  assert.ok(source.includes('await promptEvent.prompt()'), label + ' must await Chrome native install');
  assert.ok(source.includes('promptEvent.userChoice'), label + ' must handle install outcome');
  assert.ok(source.includes('choose <strong>Install</strong>'), label + ' must direct customers to actual app installation');
  assert.ok(!source.includes('Install app</strong> or <strong>Add to Home screen'), label + ' must not present a browser shortcut as an app installation');
}

async function waitForFullImageFitAssets(base) {
  const viewportStylesPath = VIEWPORT_STYLES_PATH;
  const appPath = CUSTOMER_APP_PATH;
  const promotionPath = '/frontend/customer/promotions.js?v=20261021-promo-natural-fit-v4';
  const customerCataloguePath = '/frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2';
  const addressGeocodePath = ADDRESS_GEOCODE_PATH;
  const addressSystemPath = ADDRESS_SYSTEM_PATH;
  const cataloguePath = '/frontend/admin/catalogue.js?v=20261022-invoice-tax-fields-v1';
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
      assertVersionedCodeReferences(indexHtml, indexResponse.url, 'production home');
      assertVersionedCodeReferences(adminHtml, adminResponse.url, 'production Owner');
      assert.ok(sw.includes("const CACHE = '" + EXPECTED_CUSTOMER_CACHE + "';"), 'customer service worker must publish the current cache version');
      assert.ok(sw.includes('if (cached && isVersionedCode) return cached'), 'versioned customer code should use a cache hit without a network request');
      assertCurrentScriptReference(indexHtml, indexResponse.url, appPath, 'production home');
      assertCurrentScriptReference(indexHtml, indexResponse.url, PWA_INSTALL_SCRIPT_PATH, 'production home');
      assertCurrentScriptReference(indexHtml, indexResponse.url, promotionPath, 'production home');
      assert.ok(indexHtml.includes(viewportStylesPath.slice(1)), 'production home must reference current mobile viewport styles');
      assertCurrentScriptReference(indexHtml, indexResponse.url, customerCataloguePath, 'production home');
      assertCurrentScriptReference(indexHtml, indexResponse.url, addressGeocodePath, 'production home');
      assertCurrentScriptReference(indexHtml, indexResponse.url, addressSystemPath, 'production home');
      assert.ok(sw.includes(viewportStylesPath), 'service worker must cache the current mobile viewport stylesheet');
      assert.ok(sw.includes(addressGeocodePath), 'service worker must cache the current address geocode mapper');
      assert.ok(sw.includes(addressSystemPath), 'service worker must cache the current address editor');
      assertCurrentScriptReference(adminHtml, adminResponse.url, cataloguePath, 'production Owner');
      assert.ok(sw.includes(appPath), 'service worker does not cache the current app navigation script');
      assert.ok(sw.includes(PWA_INSTALL_SCRIPT_PATH), 'service worker does not cache the current native install script');
      assert.ok(sw.includes(promotionPath), 'service worker does not cache the current promotion script');
      assert.ok(sw.includes(customerCataloguePath), 'service worker does not cache the current customer catalogue script');

      const [viewportStylesResponse, appResponse, promotionResponse, customerCatalogueResponse, addressGeocodeResponse, addressSystemResponse, catalogueResponse, installResponse] = await Promise.all([
        fetch(`${base}${viewportStylesPath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${appPath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${promotionPath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${customerCataloguePath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${addressGeocodePath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${addressSystemPath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${cataloguePath}`, { cache: 'no-store', redirect: 'follow' }),
        fetch(`${base}${PWA_INSTALL_SCRIPT_PATH}`, { cache: 'no-store', redirect: 'follow' })
      ]);
      assert.equal(viewportStylesResponse.status, 200, 'current mobile viewport stylesheet must load');
      assert.equal(appResponse.status, 200, 'current customer navigation app script must load');
      assert.equal(promotionResponse.status, 200, 'current customer promotion script must load');
      assert.equal(customerCatalogueResponse.status, 200, 'current customer catalogue script must load');
      assert.equal(addressGeocodeResponse.status, 200, 'current address geocode mapper must load');
      assert.equal(addressSystemResponse.status, 200, 'current address editor must load');
      assert.equal(catalogueResponse.status, 200, 'current Owner catalogue script must load');
      assert.equal(installResponse.status, 200, 'current native install script must load');
      for (const [label, response] of [
        ['customer stylesheet', viewportStylesResponse],
        ['customer app script', appResponse],
        ['customer promotion script', promotionResponse],
        ['customer catalogue script', customerCatalogueResponse],
        ['address geocoder script', addressGeocodeResponse],
        ['address editor script', addressSystemResponse],
        ['Owner catalogue script', catalogueResponse],
        ['customer native install script', installResponse]
      ]) assertImmutableCodeCache(response, label);

      const [viewportStylesSource, appSource, promotionSource, customerCatalogueSource, addressGeocodeSource, addressSystemSource, catalogueSource, installSource] = await Promise.all([
        viewportStylesResponse.text(), appResponse.text(), promotionResponse.text(), customerCatalogueResponse.text(), addressGeocodeResponse.text(), addressSystemResponse.text(), catalogueResponse.text(), installResponse.text()
      ]);
      assert.ok(appSource.includes("function setView(name,options){if(name==='home'&&options?.history!=='none')window.freshWayCustomerCatalogueGoHome?.();navigation.setView(name,options)"), 'home navigation must reset category state for explicit Home actions only');
      assert.ok(customerCatalogueSource.includes("window.freshWayCustomerCatalogueGoHome=()=>{const state=window.history.state;if(state?.__freshwayCustomer&&state.category)window.history.replaceState({...state,category:null},'',window.location.href);setMode(null,{history:'none'})};"), 'category home reset must preserve navigation view history');
      assert.ok(customerCatalogueSource.includes("selected=(window.history.state?.__freshwayCustomer&&window.history.state.view==='home'?window.history.state.category:null)||getStoredCategory()||null"), 'refresh must restore the selected category from history or session state');
      assert.ok(customerCatalogueSource.includes("history:selected?'replace':'none'"), 'removed categories must not remain selected in browser history');
      assertResponsiveViewportCss(viewportStylesSource, 'production');
      assertNativeInstallFlow(installSource, 'production install script');
      assert.match(promotionSource, /\.fw-promo-viewport\{[^}]*max-height:38svh/);
      assert.match(promotionSource, /sourceImage\.naturalWidth/);
      assert.match(promotionSource, /sourceImage\.naturalHeight/);
      assert.match(promotionSource, /object-fit:contain/);
      assert.match(customerCatalogueSource,/const insertAfter=hero\|\|searchWrap/);
      assert.match(customerCatalogueSource,/home\.insertBefore\(c,\s*insertAfter\.nextSibling\)/);
      assert.match(customerCatalogueSource,/heading\.classList\.add\('fw-category-home-hidden'\)/);
      assert.match(customerCatalogueSource,/if\(!selected\)\{grid\.classList\.add\('fw-category-home-hidden'\);return\}/);
      assert.match(addressGeocodeSource,/houseFlat: first\(a\.house_number, a\.house_name\)/);
      assert.match(addressGeocodeSource,/pincode: indianPincode\(a\.postcode\)/);
      assert.match(addressGeocodeSource,/landmark: first\(result && result\.name, a\.amenity, a\.shop\)/);
      assert.match(addressSystemSource, /fetch\(['"]\/api\/geocode\/reverse\?lat=/, 'address editor must call the same-origin geocoder');
      assert.ok(addressSystemSource.includes('editorCoordinates = previousCoordinates'), 'failed geocoding must restore the last verified pin');
      assert.doesNotMatch(addressSystemSource,/const preserve = labelFields\\.map/,'old address data must not overwrite newly geocoded fields');
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
  assert.ok(
    manifest.icons.some(icon => icon.sizes === size && icon.type === 'image/svg+xml'),
    'manifest must declare the FreshWay brand SVG at ' + size
  );
}
assert.equal(manifest.icons.length, 2, 'manifest must not advertise legacy P-monogram PNG icons');
assert.ok(
  manifest.icons.every(icon => /^\/icons\/icon-(?:192|512)\.svg\?v=20261024-master-logo-v1$/.test(icon.src)),
  'manifest icons must use the versioned FreshWay master-logo SVGs'
);

const logoResponse = await fetchWithRetry(`${base}/freshway-logo-master.webp?v=20261008-master-v1`);
assert.equal(logoResponse.status, 200);
assert.match(logoResponse.headers.get('content-type') || '', /^image\/webp/i, 'master FreshWay logo must be served as WebP');
const masterLogoBase64 = Buffer.from(await logoResponse.arrayBuffer()).toString('base64');
assert.ok(masterLogoBase64.length > 100, 'master FreshWay logo must contain image data');

for (const [path, size] of [
  ['/icons/icon-192.svg?v=20261024-master-logo-v1', 192],
  ['/icons/icon-512.svg?v=20261024-master-logo-v1', 512]
]) {
  const response = await fetchWithRetry(`${base}${path}`);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') || '', /^image\/svg\+xml/i, path);
  const svg = await response.text();
  assert.match(svg, /<svg\b[^>]*viewBox="0 0 512 512"/i, path + ' must be a scalable square SVG');
  assert.match(svg, /data:image\/webp;base64,/i, path + ' must embed the brand asset for reliable icon rendering');
  const embeddedLogo = svg.match(/href="data:image\/webp;base64,([^"]+)"/i)?.[1];
  assert.equal(embeddedLogo, masterLogoBase64, path + ' must embed the exact current master FreshWay logo');
  assert.match(svg, new RegExp(`width="${size}" height="${size}"`), path + ' must declare the expected intrinsic size');
}

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
  assertVersionedCodeReferences(homeHtml, homeResponse.url, 'custom-domain home');
  assertVersionedCodeReferences(adminHtml, adminResponse.url, 'custom-domain Owner');
  assert.ok(sw.includes("const CACHE = '" + EXPECTED_CUSTOMER_CACHE + "';"), 'custom-domain service worker must publish the current cache version');
  assert.ok(sw.includes('if (cached && isVersionedCode) return cached'), 'custom-domain service worker must use versioned cache hits');
  assert.equal(new URL(homeResponse.url).origin, customBase, 'home must remain on the custom domain');
  assert.match(homeHtml, /<link rel="canonical" href="https:\/\/fwcoldpressed\.in\/">/, 'custom-domain canonical URL must use the production domain');
  assert.match(homeHtml, /property="og:url" content="https:\/\/fwcoldpressed\.in\//, 'Open Graph URL must use the production domain');
  assert.match(homeHtml, /property="og:image" content="https:\/\/fwcoldpressed\.in\/freshway-whatsapp-share\.png\?v=[^"]+"/, 'WhatsApp share image must use the versioned custom-domain image');
  assert.match(homeHtml, /name="twitter:image" content="https:\/\/fwcoldpressed\.in\/freshway-whatsapp-share\.png\?v=[^"]+"/, 'Twitter share image must use the same versioned custom-domain image');
  assert.ok(homeHtml.includes(VIEWPORT_STYLES_PATH.slice(1)), 'custom-domain home must reference the current mobile viewport stylesheet');
  assert.ok(sw.includes(VIEWPORT_STYLES_PATH), 'custom-domain service worker must cache the current mobile viewport stylesheet');
  assertCurrentScriptReference(homeHtml, homeResponse.url, '/app.js?v=20261021-home-navigation-refresh-v1', 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, PWA_INSTALL_SCRIPT_PATH, 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, '/frontend/customer/promotions.js?v=20261021-promo-natural-fit-v4', 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, '/frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2', 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, ADDRESS_GEOCODE_PATH, 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, ADDRESS_SYSTEM_PATH, 'custom-domain home');
  assertCurrentScriptReference(adminHtml, adminResponse.url, '/frontend/admin/catalogue.js?v=20261022-invoice-tax-fields-v1', 'custom-domain Owner');
  assert.ok(sw.includes('/app.js?v=20261021-home-navigation-refresh-v1'), 'custom-domain service worker must cache the current app navigation script');
  assert.ok(sw.includes(PWA_INSTALL_SCRIPT_PATH), 'custom-domain service worker must cache the current native install script');
  assert.ok(sw.includes('/frontend/customer/promotions.js?v=20261021-promo-natural-fit-v4'), 'custom-domain service worker must cache the current promotion script');
  assert.ok(sw.includes('/frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2'), 'custom-domain service worker must cache the current customer catalogue script');
  assert.ok(sw.includes(ADDRESS_GEOCODE_PATH), 'custom-domain service worker must cache the current address geocode mapper');
  assert.ok(sw.includes(ADDRESS_SYSTEM_PATH), 'custom-domain service worker must cache the current address editor');

  const shareMatch = homeHtml.match(/property="og:image" content="([^"]+)"/);
  assert.ok(shareMatch, 'custom-domain Open Graph image URL must exist');
  const shareImageUrl = new URL(shareMatch[1], customBase);
  assert.equal(shareImageUrl.origin, customBase, 'share image must not point to a different host');
  const [shareImageResponse, healthResponse, productsResponse, categoriesResponse, customerCatalogueResponse, viewportStylesResponse, appResponse, addressGeocodeResponse, addressSystemResponse, installResponse] = await Promise.all([
    fetchWithRetry(shareImageUrl.href, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/api/health`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/api/products`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/api/categories`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}/frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}${VIEWPORT_STYLES_PATH}`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}${CUSTOMER_APP_PATH}`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}${ADDRESS_GEOCODE_PATH}`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}${ADDRESS_SYSTEM_PATH}`, { cache: 'no-store' }),
    fetchWithRetry(`${customBase}${PWA_INSTALL_SCRIPT_PATH}`, { cache: 'no-store' })
  ]);
  assert.equal(customerCatalogueResponse.status, 200, 'customer catalogue script must load on the custom domain');
  assert.equal(appResponse.status, 200, 'customer app navigation script must load on the custom domain');
  assert.equal(viewportStylesResponse.status, 200, 'mobile viewport stylesheet must load on the custom domain');
  assert.equal(addressGeocodeResponse.status, 200, 'address geocode mapper must load on the custom domain');
  assert.equal(addressSystemResponse.status, 200, 'address editor must load on the custom domain');
  assert.equal(installResponse.status, 200, 'native install script must load on the custom domain');
  for (const [label, response] of [
    ['custom-domain customer catalogue script', customerCatalogueResponse],
    ['custom-domain viewport stylesheet', viewportStylesResponse],
    ['custom-domain customer app script', appResponse],
    ['custom-domain geocoder script', addressGeocodeResponse],
    ['custom-domain address editor', addressSystemResponse],
    ['custom-domain native install script', installResponse]
  ]) assertImmutableCodeCache(response, label);
  const shareCacheControl = shareImageResponse.headers.get('cache-control') || '';
  assert.match(shareCacheControl, /public/i, 'WhatsApp share image must be cacheable');
  assert.match(shareCacheControl, /max-age=86400/i, 'WhatsApp share image must use a bounded cache lifetime');
  assert.match(shareCacheControl, /must-revalidate/i, 'WhatsApp share image must revalidate after expiry');
  assertResponsiveViewportCss(await viewportStylesResponse.text(), 'custom domain');
  const customerCatalogueSource = await customerCatalogueResponse.text();
  const appSource = await appResponse.text();
  const addressGeocodeSource = await addressGeocodeResponse.text();
  const addressSystemSource = await addressSystemResponse.text();
  assertNativeInstallFlow(await installResponse.text(), 'custom-domain install script');
  assert.match(addressGeocodeSource,/houseFlat: first\(a\.house_number, a\.house_name\)/);
  assert.match(addressGeocodeSource,/pincode: indianPincode\(a\.postcode\)/);
  assert.match(addressGeocodeSource,/landmark: first\(result && result\.name, a\.amenity, a\.shop\)/);
  assert.match(addressSystemSource, /fetch\(['"]\/api\/geocode\/reverse\?lat=/, 'custom-domain editor must call the same-origin geocoder');
  assert.ok(addressSystemSource.includes('editorCoordinates = previousCoordinates'), 'custom-domain editor must restore the last verified pin on lookup failure');
  assert.doesNotMatch(addressSystemSource,/const preserve = labelFields\\.map/,'custom-domain editor must not retain stale geo fields');
  assert.ok(appSource.includes("function setView(name,options){if(name==='home'&&options?.history!=='none')window.freshWayCustomerCatalogueGoHome?.();navigation.setView(name,options)"), 'custom-domain home navigation resets category state');
  assert.ok(customerCatalogueSource.includes("window.freshWayCustomerCatalogueGoHome=()=>{const state=window.history.state;if(state?.__freshwayCustomer&&state.category)window.history.replaceState({...state,category:null},'',window.location.href);setMode(null,{history:'none'})};"), 'custom-domain category state reset is current');
  assert.match(customerCatalogueSource,/const insertAfter=hero\|\|searchWrap/);
      assert.match(customerCatalogueSource,/home\.insertBefore\(c,\s*insertAfter\.nextSibling\)/);
  assert.match(customerCatalogueSource,/heading\.classList\.add\('fw-category-home-hidden'\)/);
  assert.match(customerCatalogueSource,/if\(!selected\)\{grid\.classList\.add\('fw-category-home-hidden'\);return\}/);
  assert.match(shareImageResponse.headers.get('content-type') || '', /^image\/png/i, 'WhatsApp share image must be served as PNG');
  assert.ok((await shareImageResponse.arrayBuffer()).byteLength > 100, 'WhatsApp share image must contain image data');

  const health = await healthResponse.json();
  assert.equal(health.ok, true, 'custom-domain API health check must report ok');
  assert.equal(health.service, 'freshway-api', 'custom-domain API must reach the FreshWay Worker');
  const products = await productsResponse.json();
  const categories = await categoriesResponse.json();
  const geocodeResponse = await fetchWithRetry(`${customBase}/api/geocode/reverse?lat=17.3850&lon=78.4867`, { cache: 'no-store' });
  assert.equal(geocodeResponse.status, 200, 'custom-domain reverse-geocode API must return HTTP 200');
  const geocodePayload = await geocodeResponse.json();
  assert.ok(geocodePayload.address && typeof geocodePayload.address === 'object', 'reverse-geocode API must return structured address details');
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
