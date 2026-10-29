import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL || 'https://freshway-f32.pages.dev';
const VIEWPORT_STYLES_PATH = '/styles.css?v=20261027-delivery-offers-v1';
const CUSTOMER_APP_PATH = '/app.js?v=102';
const INTERMEDIATE_CUSTOMER_APP_PATH = '/app.js?v=20261027-customer-messages-v1';
const LEGACY_CUSTOMER_APP_PATH = '/app.js?v=20261027-cancel-refresh-v1';
const SUPPORTED_CUSTOMER_APP_PATHS = [CUSTOMER_APP_PATH, INTERMEDIATE_CUSTOMER_APP_PATH, LEGACY_CUSTOMER_APP_PATH];
const CUSTOMER_MESSAGES_PATH = '/frontend/customer/messages.js?v=msg1';
const INTERMEDIATE_CUSTOMER_MESSAGES_PATH = '/frontend/customer/messages.js?v=20261027-customer-messages-v1';
const CUSTOMER_STORE_INFO_PATH = '/frontend/customer/store-info.js?v=msg1';
const INTERMEDIATE_CUSTOMER_STORE_INFO_PATH = '/frontend/customer/store-info.js?v=20261027-customer-messages-v1';
const ADDRESS_GEOCODE_PATH = '/frontend/customer/address-geocode.js?v=20261021-guest-address-map-search-v3';
const ADDRESS_SYSTEM_PATH = '/address-system-final.js?v=20261029-registration-prefill-v1';
const EXPECTED_CUSTOMER_CACHE = 'freshway-v112';
const LEGACY_CUSTOMER_CACHES = ['freshway-v111', 'freshway-v110'];
const SUPPORTED_CUSTOMER_CACHES = [EXPECTED_CUSTOMER_CACHE, ...LEGACY_CUSTOMER_CACHES];
const PWA_INSTALL_SCRIPT_PATH = '/frontend/customer/pwa-install.js?v=20261029-nonintrusive-install-v2';
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
  assert.ok(source.includes('promptEvent.prompt()'), label + ' must invoke Chrome native install');
  assert.ok(source.includes('promptEvent.userChoice'), label + ' must handle install outcome');
}

async function waitForFullImageFitAssets(base) {
  const viewportStylesPath = VIEWPORT_STYLES_PATH;
  let appPath = CUSTOMER_APP_PATH;
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
      if (!indexHtml.includes(appPath.slice(1))) appPath = SUPPORTED_CUSTOMER_APP_PATHS.find(path => indexHtml.includes(path.slice(1))) || appPath;
      const usesCustomerMessages = appPath !== LEGACY_CUSTOMER_APP_PATH;
      const messagesPath = indexHtml.includes(CUSTOMER_MESSAGES_PATH.slice(1)) ? CUSTOMER_MESSAGES_PATH : INTERMEDIATE_CUSTOMER_MESSAGES_PATH;
      const storeInfoPath = indexHtml.includes(CUSTOMER_STORE_INFO_PATH.slice(1)) ? CUSTOMER_STORE_INFO_PATH : INTERMEDIATE_CUSTOMER_STORE_INFO_PATH;
      if (appPath === CUSTOMER_APP_PATH) {
        assert.ok(indexHtml.includes(CUSTOMER_STORE_INFO_PATH.slice(1)), 'message-enabled customer app must use the current Contact Us module');
        assert.ok(indexHtml.includes(CUSTOMER_MESSAGES_PATH.slice(1)), 'message-enabled customer app must load the Messages module');
      }
      assertVersionedCodeReferences(indexHtml, indexResponse.url, 'production home');
      assertVersionedCodeReferences(adminHtml, adminResponse.url, 'production Owner');
      assert.ok(SUPPORTED_CUSTOMER_CACHES.some(cache => sw.includes("const CACHE = '" + cache + "';")), 'customer service worker must publish a supported cache version');
      if (usesCustomerMessages) {
        assert.ok(sw.includes(messagesPath), 'new customer service worker must include the Messages screen asset');
        assert.ok(sw.includes(storeInfoPath), 'new customer service worker must include the current Contact Us module');
      }
      assert.ok(sw.includes('if (isVersionedCode)') && sw.includes('return cached||Response.error()'), 'versioned customer code must refresh from network first and fall back to cache only offline');
      assertCurrentScriptReference(indexHtml, indexResponse.url, appPath, 'production home');
      if (usesCustomerMessages) {
        assertCurrentScriptReference(indexHtml, indexResponse.url, messagesPath, 'production home');
        assertCurrentScriptReference(indexHtml, indexResponse.url, storeInfoPath, 'production home');
      }
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
assert.match(indexHtml, /<link rel="icon" href="\/icons\/icon-192-brand-v2\.png\?v=20261026-brand-v2" type="image\/png" sizes="192x192">/, 'customer favicon must use the approved FreshWay brand PNG');
assert.match(indexHtml, /<link rel="apple-touch-icon" href="\/icons\/icon-192-brand-v2\.png\?v=20261026-brand-v2">/, 'customer Apple touch icon must use the approved FreshWay brand PNG');

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
const expectedBrandIcons = [
  { path: '/icons/icon-192-brand-v2.png', size: '192x192', pixels: 192, purpose: 'any' },
  { path: '/icons/icon-512-brand-v2.png', size: '512x512', pixels: 512, purpose: 'any' },
  { path: '/icons/icon-512-maskable-v2.png', size: '512x512', pixels: 512, purpose: 'maskable' }
];
assert.equal(manifest.icons.length, expectedBrandIcons.length, 'customer manifest must expose only the approved FreshWay brand PNG icons');
assert.ok(!JSON.stringify(manifest.icons).includes('/icons/icon-192.svg') && !JSON.stringify(manifest.icons).includes('/icons/icon-512.svg'), 'customer manifest must not reference the old SVG icon paths');
for (const expected of expectedBrandIcons) {
  assert.ok(
    manifest.icons.some(icon =>
      new URL(icon.src, manifestResponse.url).pathname === expected.path &&
      icon.sizes === expected.size &&
      icon.type === 'image/png' &&
      String(icon.purpose || '').split(' ').includes(expected.purpose)
    ),
    `manifest must use the approved FreshWay brand icon ${expected.path}`
  );
  const response = await fetchWithRetry(`${base}${expected.path}?v=20261026-brand-v2`, { cache: 'no-store' });
  assert.equal(response.status, 200, expected.path);
  assert.ok((response.headers.get('content-type') || '').toLowerCase().startsWith('image/png'), expected.path + ' must be served as PNG');
  const png = Buffer.from(await response.arrayBuffer());
  assert.ok(png.length > 64, expected.path + ' must contain PNG data');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', expected.path + ' must have a valid PNG signature');
  assert.equal(png.readUInt32BE(16), expected.pixels, expected.path + ' must have the expected width');
  assert.equal(png.readUInt32BE(20), expected.pixels, expected.path + ' must have the expected height');
}
assert.ok(sw.includes('/icons/icon-192-brand-v2.png?v=20261026-brand-v2'), 'customer service worker must cache the branded 192px icon');
assert.ok(sw.includes('/icons/icon-512-brand-v2.png?v=20261026-brand-v2'), 'customer service worker must cache the branded 512px icon');
assert.ok(sw.includes('/icons/icon-512-maskable-v2.png?v=20261026-brand-v2'), 'customer service worker must cache the branded maskable icon');
assert.match(sw, /icon:\s*data\.icon\s*\|\|\s*'\/icons\/icon-192-brand-v2\.png\?v=20261026-brand-v2'/, 'customer push notifications must default to the FreshWay brand icon');
assert.match(sw, /badge:\s*data\.badge\s*\|\|\s*'\/icons\/icon-192-brand-v2\.png\?v=20261026-brand-v2'/, 'customer push notifications must default to the FreshWay brand badge');

const logoResponse = await fetchWithRetry(`${base}/freshway-logo-master.webp?v=1`);
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
  assertVersionedCodeReferences(homeHtml, homeResponse.url, 'custom-domain home');
  assertVersionedCodeReferences(adminHtml, adminResponse.url, 'custom-domain Owner');
  const customAppPath = SUPPORTED_CUSTOMER_APP_PATHS.find(path => homeHtml.includes(path.slice(1))) || CUSTOMER_APP_PATH;
  const customUsesCustomerMessages = customAppPath !== LEGACY_CUSTOMER_APP_PATH;
  const customMessagesPath = homeHtml.includes(CUSTOMER_MESSAGES_PATH.slice(1)) ? CUSTOMER_MESSAGES_PATH : INTERMEDIATE_CUSTOMER_MESSAGES_PATH;
  const customStoreInfoPath = homeHtml.includes(CUSTOMER_STORE_INFO_PATH.slice(1)) ? CUSTOMER_STORE_INFO_PATH : INTERMEDIATE_CUSTOMER_STORE_INFO_PATH;
  if (customAppPath === CUSTOMER_APP_PATH) {
    assert.ok(homeHtml.includes(CUSTOMER_STORE_INFO_PATH.slice(1)), 'message-enabled custom-domain app must use the current Contact Us module');
    assert.ok(homeHtml.includes(CUSTOMER_MESSAGES_PATH.slice(1)), 'message-enabled custom-domain app must load the Messages module');
  }
  assert.ok(SUPPORTED_CUSTOMER_CACHES.some(cache => sw.includes("const CACHE = '" + cache + "';")), 'custom-domain service worker must publish a supported cache version');
  if (customUsesCustomerMessages) {
    assert.ok(sw.includes(customMessagesPath), 'new custom-domain service worker must include the Messages screen asset');
    assert.ok(sw.includes(customStoreInfoPath), 'new custom-domain service worker must include the current Contact Us module');
  }
  assert.ok(sw.includes('if (isVersionedCode)') && sw.includes('return cached||Response.error()'), 'custom-domain service worker must refresh versioned assets from network before cache fallback');
  assert.equal(new URL(homeResponse.url).origin, customBase, 'home must remain on the custom domain');
  assert.match(homeHtml, /<link rel="canonical" href="https:\/\/fwcoldpressed\.in\/">/, 'custom-domain canonical URL must use the production domain');
  assert.match(homeHtml, /property="og:url" content="https:\/\/fwcoldpressed\.in\//, 'Open Graph URL must use the production domain');
  assert.match(homeHtml, /property="og:image" content="https:\/\/fwcoldpressed\.in\/freshway-whatsapp-share\.png\?v=[^"]+"/, 'WhatsApp share image must use the versioned custom-domain image');
  assert.match(homeHtml, /name="twitter:image" content="https:\/\/fwcoldpressed\.in\/freshway-whatsapp-share\.png\?v=[^"]+"/, 'Twitter share image must use the same versioned custom-domain image');
  assert.ok(homeHtml.includes(VIEWPORT_STYLES_PATH.slice(1)), 'custom-domain home must reference the current mobile viewport stylesheet');
  assert.ok(sw.includes(VIEWPORT_STYLES_PATH), 'custom-domain service worker must cache the current mobile viewport stylesheet');
  assertCurrentScriptReference(homeHtml, homeResponse.url, customAppPath, 'custom-domain home');
  if (customUsesCustomerMessages) {
    assertCurrentScriptReference(homeHtml, homeResponse.url, customMessagesPath, 'custom-domain home');
    assertCurrentScriptReference(homeHtml, homeResponse.url, customStoreInfoPath, 'custom-domain home');
  }
  assertCurrentScriptReference(homeHtml, homeResponse.url, PWA_INSTALL_SCRIPT_PATH, 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, '/frontend/customer/promotions.js?v=20261021-promo-natural-fit-v4', 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, '/frontend/customer/catalogue.js?v=20261021-full-images-refresh-v2', 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, ADDRESS_GEOCODE_PATH, 'custom-domain home');
  assertCurrentScriptReference(homeHtml, homeResponse.url, ADDRESS_SYSTEM_PATH, 'custom-domain home');
  assertCurrentScriptReference(adminHtml, adminResponse.url, '/frontend/admin/catalogue.js?v=20261022-invoice-tax-fields-v1', 'custom-domain Owner');
  assert.ok(sw.includes(customAppPath), 'custom-domain service worker must cache the current app navigation script');
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
    fetchWithRetry(`${customBase}${customAppPath}`, { cache: 'no-store' }),
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
