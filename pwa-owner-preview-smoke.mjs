import assert from 'node:assert/strict';

const BASE_URL = (process.env.PREVIEW_BASE_URL || '').replace(/\/$/, '');
if (!BASE_URL) throw new Error('PREVIEW_BASE_URL is required for Owner PWA preview smoke');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPreviewRoute(path, attempts = 60) {
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

const pageResponse = await fetchPreviewRoute('/admin/');
assertFreshResponse(pageResponse, 'Owner app shell');
assert.equal(new URL(pageResponse.url).pathname, '/admin/', 'Owner app canonical route must have a trailing slash');
assert.match(pageResponse.headers.get('content-type') || '', /text\/html/i);
const html = await pageResponse.text();
assert.match(html, /<link rel="manifest" href="\/admin\/manifest\.webmanifest">/);
assert.match(html, /navigator\.serviceWorker\.register\("\/admin\/sw\.js",\{scope:"\/admin\/",updateViaCache:"none"\}\)/);
assert.match(html, /FreshWay — Owner/);

for (const [, value] of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
  if (value.startsWith('#') || value === '/' || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
  const url = new URL(value, pageResponse.url);
  assert.ok(url.pathname.startsWith('/admin/'), `Owner HTML resource/link escaped the /admin/ scope: ${value}`);
}

const manifestResponse = await fetchPreviewRoute('/admin/manifest.webmanifest');
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

const workerResponse = await fetchPreviewRoute('/admin/sw.js');
assertFreshResponse(workerResponse, 'Owner service worker');
assert.match(workerResponse.headers.get('content-type') || '', /javascript/i);
assert.equal(workerResponse.headers.get('service-worker-allowed'), '/admin/');
const worker = await workerResponse.text();
assert.match(worker, /const CACHE = 'fw-owner-v[0-9]+'/);
assert.match(worker, /if \(!url\.pathname\.startsWith\('\/admin\/'\)\) return;/);

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

console.log('Owner PWA preview smoke OK');
console.log(JSON.stringify({
  baseUrl: BASE_URL,
  appRoute: pageResponse.url,
  manifest: { id: manifest.id, start_url: manifest.start_url, scope: manifest.scope, iconCount: manifest.icons.length },
  serviceWorkerAllowed: workerResponse.headers.get('service-worker-allowed'),
  checkedAssetCount: assetResponses.length,
  assets: assetResponses
}, null, 2));
