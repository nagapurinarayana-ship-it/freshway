import assert from 'node:assert/strict';

const BASE_URL = (process.env.OWNER_PWA_BASE_URL || '').replace(/\/$/, '');
if (!BASE_URL) throw new Error('OWNER_PWA_BASE_URL is required for Owner PWA deployment smoke');

const EXPECTED_OWNER_ADMIN_SCRIPT = '/admin/admin.js?v=20261021-owner-alert-history-v1';
const EXPECTED_OWNER_ALERTS_SCRIPT = '/admin/frontend/admin/order-alerts.js?v=20261021-owner-alert-history-v1';
const EXPECTED_OWNER_STORE_PROFILE_SCRIPT = '/admin/frontend/admin/store-profile.js?v=20261021-free-osm-picker-v1';
const EXPECTED_OWNER_CACHE = 'fw-owner-v19';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        const currentAdmin = hasScriptReference(html, response.url, EXPECTED_OWNER_ADMIN_SCRIPT);
        const currentAlerts = hasScriptReference(html, response.url, EXPECTED_OWNER_ALERTS_SCRIPT);
        const currentStoreProfile = hasScriptReference(html, response.url, EXPECTED_OWNER_STORE_PROFILE_SCRIPT);
        if (currentAdmin && currentAlerts && currentStoreProfile) return { response, html };
        lastError = new Error('/admin/ still serves stale Owner assets (attempt ' + attempt + '/' + attempts + '); expected ' + EXPECTED_OWNER_ADMIN_SCRIPT + ', ' + EXPECTED_OWNER_ALERTS_SCRIPT + ' and ' + EXPECTED_OWNER_STORE_PROFILE_SCRIPT);
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
        const currentCache = worker.includes("const CACHE = '" + EXPECTED_OWNER_CACHE + "';");
        const currentAdmin = worker.includes(EXPECTED_OWNER_ADMIN_SCRIPT);
        const currentAlerts = worker.includes(EXPECTED_OWNER_ALERTS_SCRIPT);
        const currentStoreProfile = worker.includes(EXPECTED_OWNER_STORE_PROFILE_SCRIPT);
        if (currentCache && currentAdmin && currentAlerts && currentStoreProfile) return { response, worker };
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
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_ADMIN_SCRIPT), 'Owner app must load the latest login-aware admin script');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_ALERTS_SCRIPT), 'Owner app must load the latest login-aware push setup script');
assert.ok(hasScriptReference(html, pageResponse.url, EXPECTED_OWNER_STORE_PROFILE_SCRIPT), 'Owner app must load the latest business profile and shop pin editor');

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
assert.ok(manifest.icons.length >= 2);
assert.ok(manifest.icons.every(icon => icon.src.startsWith('/admin/')), 'Owner installation icons must remain under /admin/');

const { response: workerResponse, worker } = await fetchCurrentOwnerServiceWorker();
assertFreshResponse(workerResponse, 'Owner service worker');
assert.match(workerResponse.headers.get('content-type') || '', /javascript/i);
assert.equal(workerResponse.headers.get('service-worker-allowed'), '/admin/');
assert.ok(worker.includes("const CACHE = '" + EXPECTED_OWNER_CACHE + "';"), 'Owner service worker must publish the latest cache version');
assert.ok(worker.includes(EXPECTED_OWNER_ADMIN_SCRIPT), 'Owner service worker shell must cache the latest Owner script');
assert.ok(worker.includes(EXPECTED_OWNER_ALERTS_SCRIPT), 'Owner service worker shell must cache the latest push setup script');
assert.ok(worker.includes(EXPECTED_OWNER_STORE_PROFILE_SCRIPT), 'Owner service worker shell must cache the latest shop location editor');
const installScriptResponse = await fetchOwnerRoute(installScriptUrl.pathname + installScriptUrl.search);
assertFreshResponse(installScriptResponse, 'Owner install/bootstrap script');
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
  assertFreshResponse(response, 'Owner shell asset ' + path);
  const type = response.headers.get('content-type') || '';
  if (path.endsWith('.js')) assert.match(type, /javascript/i, path);
  if (path.endsWith('.css')) assert.match(type, /text\/css/i, path);
  if (path.endsWith('.webmanifest')) assert.match(type, /application\/manifest\+json/i, path);
  if (path.endsWith('.png')) assert.match(type, /image\/png/i, path);
  if (path.endsWith('.svg')) assert.match(type, /image\/svg\+xml/i, path);
  if (path.endsWith('.webp')) assert.match(type, /image\/webp/i, path);
  const bytes = await response.arrayBuffer();
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
