import assert from 'node:assert/strict';

const BASE_URL = (process.env.OWNER_PWA_BASE_URL || '').replace(/\/$/, '');
if (!BASE_URL) throw new Error('OWNER_PWA_BASE_URL is required for Owner PWA deployment smoke');

const EXPECTED_OWNER_CSS = '/admin/admin.css?v=20261027-delivery-offers-v2';
const EXPECTED_OWNER_ADMIN_SCRIPT = '/admin/admin.js?v=20261029-order-shortcuts-v1';
const LEGACY_OWNER_ADMIN_SCRIPT = '/admin/admin.js?v=20261028-nav-refresh-v1';
const OLDER_OWNER_ADMIN_SCRIPT = '/admin/admin.js?v=20261027-owner-offers-route-v1';
const OLDEST_OWNER_ADMIN_SCRIPT = '/admin/admin.js?v=20261027-delivery-offers-v2';
const SUPPORTED_OWNER_ADMIN_SCRIPTS = [EXPECTED_OWNER_ADMIN_SCRIPT, LEGACY_OWNER_ADMIN_SCRIPT, OLDER_OWNER_ADMIN_SCRIPT, OLDEST_OWNER_ADMIN_SCRIPT];
const EXPECTED_OWNER_CUSTOMER_MESSAGES_SCRIPT = '/admin/frontend/admin/customer-messages.js?v=20261027-customer-messages-v1';
const EXPECTED_OWNER_INVOICE_SETTINGS_SCRIPT = '/admin/frontend/admin/invoice-settings.js?v=20261023-available-fields-invoice-v2';
const EXPECTED_OWNER_ACCOUNT_DELETIONS_SCRIPT = '/admin/frontend/admin/account-deletions.js?v=20261024-anonymized-history-v1';
const EXPECTED_OWNER_ALERTS_SCRIPT = '/admin/frontend/admin/order-alerts.js?v=20261021-owner-push-diagnostics-v1';
const EXPECTED_OWNER_STORE_PROFILE_SCRIPT = '/admin/frontend/admin/store-profile.js?v=20261024-response-guard-v2';
const EXPECTED_OWNER_DELIVERY_SCRIPT = '/admin/frontend/admin/delivery-management.js?v=20261026-date-only-v2';
const EXPECTED_OWNER_STORE_MANAGEMENT_SCRIPT = '/admin/frontend/admin/store-management.js?v=20261027-store-manager-v1';
const EXPECTED_OWNER_DELIVERY_OFFERS_SCRIPT = '/admin/frontend/admin/delivery-offers.js?v=20261027-coupon-buttons-v5';
const EXPECTED_OWNER_LIFECYCLE_SCRIPT = '/admin/owner-lifecycle.js?v=20261029-test-order-manual-tab-v1';
const EXPECTED_OWNER_CACHE = 'fw-owner-v57';
const LEGACY_OWNER_CACHE = 'fw-owner-v56';
const OLDER_OWNER_CACHE = 'fw-owner-v55';
const SUPPORTED_OWNER_CACHES = [EXPECTED_OWNER_CACHE, LEGACY_OWNER_CACHE, OLDER_OWNER_CACHE];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertCacheableOwnerAsset(response, label, path) {
  assert.equal(response.status, 200, label + ' must return HTTP 200');
  const pathname = String(path).split('?')[0];
  const hasVersion = /[?&]v=[^&]+/.test(String(path));
  const cacheControl = response.headers.get('cache-control') || '';
  if (/\.(?:js|css)$/i.test(pathname)) {
    assert.match(cacheControl, /public/i, label + ' must be public-cacheable');
    assert.match(cacheControl, /max-age=31536000/i, label + ' must use the versioned one-year cache lifetime');
    assert.match(cacheControl, /immutable/i, label + ' must declare immutable');
    assert.ok(hasVersion, label + ' code URL must contain its release version');
  } else if (/\.(?:svg|webp|png|jpe?g|avif|ico|woff2?)$/i.test(pathname) && hasVersion) {
    assert.match(cacheControl, /public/i, label + ' versioned media must be cacheable');
    assert.match(cacheControl, /max-age=31536000/i, label + ' versioned media must use a long-lived cache');
    assert.match(cacheControl, /immutable/i, label + ' versioned media must declare immutable');
  } else if (/\.(?:svg|webp|png|jpe?g|avif|ico|woff2?)$/i.test(pathname)) {
    assert.match(cacheControl, /public/i, label + ' media must be cacheable');
    assert.match(cacheControl, /max-age=86400/i, label + ' media must use a bounded cache lifetime');
    assert.match(cacheControl, /must-revalidate/i, label + ' media must revalidate after expiry');
  } else {
    assertFreshResponse(response, label);
  }
}

async function fetchOwnerRoute(path, attempts = 60) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(BASE_URL + path, { cache: 'no-store', redirect: 'follow' });
      if (response.ok) return response;
      lastError = new Error(`${path} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(5000);
  }
  throw lastError;
}

function assertFreshResponse(response, label) {
  assert.equal(response.status, 200, `${label} must return HTTP 200`);
  assert.match(response.headers.get('cache-control') || '', /no-store|no-cache/i, `${label} must not serve a stale shell/asset`);
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/i, `${label} must be excluded from search indexing`);
}

function hasStyleReference(html, pageUrl, expectedPath) {
  const expected = new URL(expectedPath, pageUrl);
  return [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].some(([, href]) => {
    try {
      const actual = new URL(href, pageUrl);
      return actual.pathname === expected.pathname && actual.search === expected.search;
    } catch (_) {
      return false;
    }
  });
}

function hasScriptReference(html, pageUrl, expectedPath) {
  const expected = new URL(expectedPath, pageUrl);
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].some(([, src]) => {
    try {
      const actual = new URL(src, pageUrl);
      return actual.pathname === expected.pathname && actual.search === expected.search;
    } catch (_) {
      return false;
    }
  });
}

// Do not pass merely because an old but healthy deployment is still available.
// Poll cache-busted production reads while Cloudflare Pages publishes the new release.
async function fetchCurrentOwnerAppShell(attempts = 60) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const probe = new URL('/admin/', BASE_URL);
      probe.searchParams.set('__freshway_owner_release_probe', Date.now() + '-' + attempt);
      const response = await fetch(probe, { cache: 'no-store', redirect: 'follow' });
      if (!response.ok) {
        lastError = new Error('/admin/ returned HTTP ' + response.status);
      } else {
        const html = await response.text();
        const currentCss = hasStyleReference(html, response.url, EXPECTED_OWNER_CSS);
        const currentAdmin = SUPPORTED_OWNER_ADMIN_SCRIPTS.some(script => hasScriptReference(html, response.url, script));
        const needsCustomerMessages = hasScriptReference(html, response.url, EXPECTED_OWNER_ADMIN_SCRIPT);
        const currentCustomerMessages = hasScriptReference(html, response.url, EXPECTED_OWNER_CUSTOMER_MESSAGES_SCRIPT);
        const currentInvoiceSettings = hasScriptReference(html, response.url, EXPECTED_OWNER_INVOICE_SETTINGS_SCRIPT);
        const currentAccountDeletions = hasScriptReference(html, response.url, EXPECTED_OWNER_ACCOUNT_DELETIONS_SCRIPT);
        const currentAlerts = hasScriptReference(html, response.url, EXPECTED_OWNER_ALERTS_SCRIPT);
        const currentStoreProfile = hasScriptReference(html, response.url, EXPECTED_OWNER_STORE_PROFILE_SCRIPT);
        const currentDelivery = hasScriptReference(html, response.url, EXPECTED_OWNER_DELIVERY_SCRIPT);
        const currentStoreManagement = hasScriptReference(html, response.url, EXPECTED_OWNER_STORE_MANAGEMENT_SCRIPT);
        const currentLifecycle = hasScriptReference(html, response.url, EXPECTED_OWNER_LIFECYCLE_SCRIPT);
        const currentDeliveryOffers = hasScriptReference(html, response.url, EXPECTED_OWNER_DELIVERY_OFFERS_SCRIPT);
        if (currentCss && currentAdmin && (!needsCustomerMessages || currentCustomerMessages) && currentInvoiceSettings && currentAccountDeletions && currentAlerts && currentStoreProfile && currentDelivery && currentStoreManagement && currentLifecycle && currentDeliveryOffers) return { response, html };
        lastError = new Error('/admin/ still serves stale Owner assets (attempt ' + attempt + '/' + attempts + '); expected ' + EXPECTED_OWNER_CSS + ', ' + EXPECTED_OWNER_ADMIN_SCRIPT + ', ' + EXPECTED_OWNER_INVOICE_SETTINGS_SCRIPT + ', ' + EXPECTED_OWNER_ACCOUNT_DELETIONS_SCRIPT + ', ' + EXPECTED_OWNER_ALERTS_SCRIPT + ', ' + EXPECTED_OWNER_STORE_PROFILE_SCRIPT + ', ' + EXPECTED_OWNER_DELIVERY_SCRIPT + ', ' + EXPECTED_OWNER_STORE_MANAGEMENT_SCRIPT + ', ' + EXPECTED_OWNER_LIFECYCLE_SCRIPT + ' and ' + EXPECTED_OWNER_DELIVERY_OFFERS_SCRIPT);
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(5000);
  }
  throw lastError || new Error('Owner app shell did not reach the expected release.');
}

async function fetchCurrentOwnerServiceWorker(attempts = 60) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const url = new URL('/admin/sw.js', BASE_URL);
      url.searchParams.set('__freshway_owner_release_probe', Date.now() + '-' + attempt);
      const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      if (!response.ok) {
        lastError = new Error('/admin/sw.js returned HTTP ' + response.status);
      } else {
        const worker = await response.text();
        const currentCache = SUPPORTED_OWNER_CACHES.some(cache => worker.includes("const CACHE = '" + cache + "';"));
        const needsCustomerMessages = worker.includes("const CACHE = '" + EXPECTED_OWNER_CACHE + "';");
        const currentCss = worker.includes(EXPECTED_OWNER_CSS);
        const currentAdmin = SUPPORTED_OWNER_ADMIN_SCRIPTS.some(script => worker.includes(script));
        const currentCustomerMessages = worker.includes(EXPECTED_OWNER_CUSTOMER_MESSAGES_SCRIPT);
        const currentInvoiceSettings = worker.includes(EXPECTED_OWNER_INVOICE_SETTINGS_SCRIPT);
        const currentAccountDeletions = worker.includes(EXPECTED_OWNER_ACCOUNT_DELETIONS_SCRIPT);
        const currentAlerts = worker.includes(EXPECTED_OWNER_ALERTS_SCRIPT);
        const currentStoreProfile = worker.includes(EXPECTED_OWNER_STORE_PROFILE_SCRIPT);
        const currentDelivery = worker.includes(EXPECTED_OWNER_DELIVERY_SCRIPT);
        const currentStoreManagement = worker.includes(EXPECTED_OWNER_STORE_MANAGEMENT_SCRIPT);
        const currentLifecycle = worker.includes(EXPECTED_OWNER_LIFECYCLE_SCRIPT);
        const currentDeliveryOffers = worker.includes(EXPECTED_OWNER_DELIVERY_OFFERS_SCRIPT);
        if (currentCache && currentCss && currentAdmin && (!needsCustomerMessages || currentCustomerMessages) && currentInvoiceSettings && currentAccountDeletions && currentAlerts && currentStoreProfile && currentDelivery && currentStoreManagement && currentLifecycle && currentDeliveryOffers) return { response, worker };
        lastError = new Error('/admin/sw.js still serves stale Owner cache/assets (attempt ' + attempt + '/' + attempts + '); expected ' + EXPECTED_OWNER_CACHE + ' and current Owner script URLs');
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(5000);
  }
  throw lastError || new Error('Owner service worker did not reach the expected release.');
}

const { response: pageResponse, html } = await fetchCurrentOwnerAppShell();
console.log('Owner deployment route diagnostics:', JSON.stringify({ url: pageResponse.url, status: pageResponse.status, contentType: pageResponse.headers.get('content-type'), cacheControl: pageResponse.headers.get('cache-control'), robots: pageResponse.headers.get('x-robots-tag'), bodyStart: html.slice(0, 180) }));
assertFreshResponse(pageResponse, 'Owner app shell');
assert.equal(new URL(pageResponse.url).pathname, '/admin/', 'Owner app canonical route must have a trailing slash');
assert.match(pageResponse.headers.get('content-type') || '', /text\/html/i);
assert.match(html, /<link rel="manifest" href="\/admin\/manifest\.webmanifest">/);
const installScriptMatch = html.match(/<script\b[^>]*\bsrc=["']([^"']*\/admin\/owner-pwa-install\.js(?:\?[^"']*)?)["'][^>]*>/i);
assert.ok(installScriptMatch, 'Owner app must load the install and service-worker bootstrap script');
const installScriptUrl = new URL(installScriptMatch[1], pageResponse.url);
assert.equal(installScriptUrl.origin, new URL(pageResponse.url).origin, 'Owner bootstrap must remain same-origin');
assert.ok(installScriptUrl.pathname.startsWith('/admin/'), 'Owner bootstrap must stay inside the /admin/ scope');
assert.match(html, /FreshWay — Owner/);
assert.ok(hasStyleReference(html, pageResponse.url, EXPECTED_OWNER_CSS), 'Owner app must load the latest Owner CSS version');
  assert.ok(SUPPORTED_OWNER_ADMIN_SCRIPTS.some(script => hasScriptReference(html, pageResponse.url, script)), 'Owner app must load a supported versioned login-aware admin script');
if (hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_ADMIN_SCRIPT)) assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_CUSTOMER_MESSAGES_SCRIPT), 'new Owner script must load Customer Messages');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_INVOICE_SETTINGS_SCRIPT), 'Owner app must load the refreshed optional invoice settings script');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_ACCOUNT_DELETIONS_SCRIPT), 'Owner app must load the account-deletion request queue');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_ALERTS_SCRIPT), 'Owner app must load the latest login-aware push setup script');
assert.match(html, /id="ownerOrderAlertTest"/, 'Owner app must expose the push delivery test control');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_STORE_PROFILE_SCRIPT), 'Owner app must load the latest business profile and shop pin editor');
  assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_DELIVERY_SCRIPT), 'Owner app must load delivery scheduling and exception management');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_STORE_MANAGEMENT_SCRIPT), 'Owner app must load Store Manager and Customer Requests');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_DELIVERY_OFFERS_SCRIPT), 'Owner app must load Delivery & Offers');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_LIFECYCLE_SCRIPT), 'Owner app must load the cache-busted order lifecycle map handler');

for (const [, value] of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
  if (value.startsWith('#') || value === '/' || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
  const url = new URL(value, pageResponse.url);
  assert.ok(url.pathname.startsWith('/admin/'), `Owner HTML resource/link escaped the /admin/ scope: ${value}`);
}

const manifestResponse = await fetchOwnerRoute('/admin/manifest.webmanifest');
assertFreshResponse(manifestResponse, 'Owner manifest');
assert.match(manifestResponse.headers.get('content-type') || '', /application\/manifest\+json/i);
const manifest = await manifestResponse.json();
assert.equal(manifest.name, 'FreshWay Owner');
assert.equal(manifest.id, '/admin/freshway-owner');
assert.equal(manifest.start_url, '/admin/');
assert.equal(manifest.scope, '/admin/');
assert.equal(manifest.display, 'standalone');
const expectedOwnerIcons = [
  { path: '/admin/icons/icon-192-brand-v2.png', size: '192x192', purpose: 'any' },
  { path: '/admin/icons/icon-512-brand-v2.png', size: '512x512', purpose: 'any' },
  { path: '/admin/icons/icon-512-maskable-v2.png', size: '512x512', purpose: 'maskable' }
];
assert.equal(manifest.icons.length, expectedOwnerIcons.length, 'Owner manifest must expose only the approved FreshWay brand PNG icons');
for (const expected of expectedOwnerIcons) {
  assert.ok(manifest.icons.some(icon =>
    new URL(icon.src, manifestResponse.url).pathname === expected.path &&
    icon.sizes === expected.size &&
    icon.type === 'image/png' &&
    String(icon.purpose || '').split(' ').includes(expected.purpose)
  ), 'Owner manifest must reference the approved FreshWay brand icon ' + expected.path);
}
assert.ok(!JSON.stringify(manifest.icons).includes('/admin/icons/icon-192.svg') && !JSON.stringify(manifest.icons).includes('/admin/icons/icon-512.svg'), 'Owner manifest must not reference the old SVG icon paths');
assert.ok(manifest.icons.every(icon => icon.src.startsWith('/admin/')), 'Owner installation icons must remain under /admin/');

const { response: workerResponse, worker } = await fetchCurrentOwnerServiceWorker();
assertFreshResponse(workerResponse, 'Owner service worker');
assert.match(workerResponse.headers.get('content-type') || '', /javascript/i);
assert.equal(workerResponse.headers.get('service-worker-allowed'), '/admin/');
assert.ok(SUPPORTED_OWNER_CACHES.some(cache => worker.includes("const CACHE = '" + cache + "';")), 'Owner service worker must publish a supported cache version');
if (worker.includes("const CACHE = '" + EXPECTED_OWNER_CACHE + "';")) assert.ok(worker.includes(EXPECTED_OWNER_CUSTOMER_MESSAGES_SCRIPT), 'new Owner cache must include Customer Messages');
assert.ok(worker.includes("icon: data.icon || '/admin/icons/icon-192-brand-v2.png?v=20261026-brand-v2'"), 'Owner notifications must default to the FreshWay brand icon');
assert.ok(worker.includes("badge: data.badge || '/admin/icons/icon-192-brand-v2.png?v=20261026-brand-v2'"), 'Owner notifications must default to the FreshWay brand badge');
assert.ok(worker.includes(EXPECTED_OWNER_CSS), 'Owner service worker shell must cache the latest Owner CSS version');
  assert.ok(SUPPORTED_OWNER_ADMIN_SCRIPTS.some(script => worker.includes(script)), 'Owner service worker shell must cache a supported Owner script');
assert.ok(worker.includes(EXPECTED_OWNER_INVOICE_SETTINGS_SCRIPT), 'Owner service worker shell must cache the refreshed invoice settings script');
assert.ok(worker.includes(EXPECTED_OWNER_ACCOUNT_DELETIONS_SCRIPT), 'Owner service worker shell must cache the account-deletion request queue');
assert.ok(worker.includes(EXPECTED_OWNER_ALERTS_SCRIPT), 'Owner service worker shell must cache the latest push setup script');
assert.ok(worker.includes(EXPECTED_OWNER_STORE_PROFILE_SCRIPT), 'Owner service worker shell must cache the latest shop location editor');
  assert.ok(worker.includes(EXPECTED_OWNER_DELIVERY_SCRIPT), 'Owner service worker shell must cache delivery scheduling and exception management');
assert.ok(worker.includes(EXPECTED_OWNER_STORE_MANAGEMENT_SCRIPT), 'Owner service worker shell must cache Store Manager and Customer Requests');
assert.ok(worker.includes(EXPECTED_OWNER_DELIVERY_OFFERS_SCRIPT), 'Owner service worker shell must cache Delivery & Offers');
assert.ok(worker.includes(EXPECTED_OWNER_LIFECYCLE_SCRIPT), 'Owner service worker shell must cache the latest order lifecycle map handler');
const installScriptResponse = await fetchOwnerRoute(installScriptUrl.pathname + installScriptUrl.search);
assertCacheableOwnerAsset(installScriptResponse, 'Owner install/bootstrap script', installScriptUrl.pathname + installScriptUrl.search);
assert.match(installScriptResponse.headers.get('content-type') || '', /javascript/i);
const installScript = await installScriptResponse.text();
assert.match(installScript, /navigator\.serviceWorker\.register\(\s*['"]\/admin\/sw\.js['"]\s*,\s*\{\s*scope:\s*['"]\/admin\/['"]\s*,\s*updateViaCache:\s*['"]none['"]\s*\}\s*\)/, 'Owner bootstrap must register the scoped service worker with cache bypass');
assert.match(worker, /const CACHE = 'fw-owner-v[0-9]+'/);
assert.match(worker, /if \(!url\.pathname\.startsWith\('\/admin\/'\)\) return;/);

// This read-only, unauthenticated status endpoint verifies that the deployed
// Owner PWA's same-origin API route reaches the real Worker without exercising
// login, changing data, or using production credentials.
const ownerApiStatusResponse = await fetchOwnerRoute('/api/admin/status');
assert.ok(String(ownerApiStatusResponse.headers.get('content-type') || '').toLowerCase().includes('application/json'), 'Owner API status must return JSON');
assert.match(ownerApiStatusResponse.headers.get('cache-control') || '', /no-store/i);
const ownerApiStatus = await ownerApiStatusResponse.json();
assert.equal(ownerApiStatus.ok, true, 'Owner API status must report success');
assert.ok(typeof ownerApiStatus.version === 'string' && ownerApiStatus.version.length > 0, 'Owner API auth/version endpoint must be reachable');

const shellMatch = worker.match(/const SHELL = \[([\s\S]*?)\];/);
assert.ok(shellMatch, 'Owner service-worker shell list must exist');
const shellPaths = [...shellMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, path]) => path);
assert.ok(shellPaths.length >= 15, 'Owner service-worker shell should include its critical assets');
assert.ok(shellPaths.every(path => path.startsWith('/admin/')), 'Every Owner service-worker shell URL must be in scope');

const assetResponses = await Promise.all(shellPaths.map(async path => {
  const response = await fetch(BASE_URL + path, { cache: 'no-store', redirect: 'follow' });
  if (path === '/admin/' || path.endsWith('.webmanifest')) assertFreshResponse(response, 'Owner shell asset ' + path);
  else assertCacheableOwnerAsset(response, 'Owner shell asset ' + path, path);
  const type = response.headers.get('content-type') || '';
  if (path.endsWith('.js')) assert.match(type, /javascript/i, path);
  if (path.endsWith('.css')) assert.match(type, /text\/css/i, path);
  if (path.endsWith('.webmanifest')) assert.match(type, /application\/manifest\+json/i, path);
  if (path.endsWith('.png')) assert.match(type, /image\/png/i, path);
  if (path.endsWith('.svg')) assert.match(type, /image\/svg\+xml/i, path);
  if (path.endsWith('.webp')) assert.match(type, /image\/webp/i, path);
  const bytes = await response.arrayBuffer();
  if (path === EXPECTED_OWNER_STORE_PROFILE_SCRIPT) {
    const deployedSource = new TextDecoder().decode(bytes);
    assert.match(deployedSource, /function readProfileResponse\(data\)/, 'deployed Store Profile script must validate API responses before applying values');
    assert.match(deployedSource, /incomplete Store Profile/, 'deployed Store Profile script must reject malformed responses without clearing the form');
  }
  assert.ok(bytes.byteLength > 0, path + ' must not be empty');
  return { path, status: response.status, contentType: type, bytes: bytes.byteLength };
}));

console.log('Owner PWA deployment smoke OK');
console.log(JSON.stringify({
  baseUrl: BASE_URL,
  appRoute: pageResponse.url,
  manifest: { id: manifest.id, start_url: manifest.start_url, scope: manifest.scope, iconCount: manifest.icons.length },
  serviceWorkerAllowed: workerResponse.headers.get('service-worker-allowed'),
  ownerApiStatus: { ok: ownerApiStatus.ok, version: ownerApiStatus.version },
  checkedAssetCount: assetResponses.length,
  assets: assetResponses
}, null, 2));
