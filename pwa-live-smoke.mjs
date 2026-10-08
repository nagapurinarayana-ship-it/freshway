const assert = require('node:assert/strict');

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

const base = BASE_URL.replace(/\/$/, '');

const indexResponse = await fetchWithRetry(`${base}/`);
assert.equal(indexResponse.url, `${base}/`);
const indexHtml = await indexResponse.text();
assert.equal(indexResponse.status, 200);
assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);

const manifestResponse = await fetchWithRetry(`${base}/manifest.webmanifest`);
assert.equal(manifestResponse.url, `${base}/manifest.webmanifest`);
assert.equal(manifestResponse.status, 200);
assert.match(
  manifestResponse.headers.get('content-type') || '',
  /application\/manifest\+json/i,
  'manifest must be served as application/manifest+json'
);

const manifest = await manifestResponse.json();
assert.equal(manifest.name, 'FreshWay');
assert.equal(manifest.short_name, 'FreshWay');
assert.equal(manifest.id, '/');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.prefer_related_applications, false);
for (const size of ['192x192', '512x512']) {
  assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.type === 'image/png'));
}

for (const path of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-192-maskable.png', '/icons/icon-512-maskable.png']) {
  const response = await fetchWithRetry(`${base}${path}`);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') || '', /^image\/png/i, path);
  assert.ok((await response.arrayBuffer()).byteLength > 100, path);
}

const swResponse = await fetchWithRetry(`${base}/sw.js`);
assert.equal(swResponse.status, 200);
assert.match(swResponse.headers.get('content-type') || '', /javascript/i, 'service worker must be JavaScript');
assert.equal(swResponse.headers.get('service-worker-allowed'), '/', 'service worker must explicitly allow root scope');
const sw = await swResponse.text();
assert.match(sw, /const CACHE = 'freshway-v28'/);
assert.match(sw, /const REQUIRED_SHELL = \[\s*'\/',\s*'\/index\.html'\s*\]/);

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
