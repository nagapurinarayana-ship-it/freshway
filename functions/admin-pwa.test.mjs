import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from './admin/[[path]].js';

const readRepoFile = path => readFileSync(new URL('../' + path.replace(/^\//, ''), import.meta.url));
const sourceHtml = readRepoFile('admin.html').toString('utf8');
const customerHtml = readRepoFile('index.html').toString('utf8');
assert.doesNotMatch(customerHtml, /href=["']\/admin(?:\.html|\/?)['"]/i, 'customer app must not expose an Owner dashboard link');
assert.doesNotMatch(customerHtml, /class=["'][^"']*\badmin-link\b/i, 'customer profile must not render an Owner dashboard shortcut');
const ownerManifestSource = readRepoFile('admin/manifest.webmanifest').toString('utf8');
const ownerWorkerSource = readRepoFile('admin/sw.js').toString('utf8');
const requiredOwnerAssets = [
  'admin.css',
  'admin.js',
  'freshway-logo-master.webp',
  'freshway-logo-clean.svg',
  'frontend/phone-display.js',
  'frontend/admin/store-profile.js',
  'frontend/catalogue-media.js',
  'frontend/admin/catalogue.js',
  'frontend/admin/owner-lifecycle-autosave.js',
  'frontend/admin/push.js',
  'owner-lifecycle.js',
  'owner-address-final.js',
  'frontend/media/catalogue/groundnut-oil.svg',
  'frontend/media/catalogue/sunflower-oil.svg',
  'frontend/media/catalogue/hmt-rice.svg',
  'frontend/media/catalogue/sona-masuri.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-192-maskable.png',
  'icons/icon-512-maskable.png'
];

function makeContext(path, method = 'GET') {
  const fetched = [];
  return {
    fetched,
    context: {
      request: new Request('https://fwcoldpressed.in' + path, { method }),
      env: { ASSETS: { fetch: async request => {
        const requested = new URL(request.url);
        fetched.push({ pathname: requested.pathname, search: requested.search, method: request.method });
        let body;
        let contentType = 'application/octet-stream';
        if (requested.pathname === '/admin.html') {
          body = sourceHtml;
          contentType = 'text/html; charset=UTF-8';
        } else if (requested.pathname === '/admin/sw.js') {
          body = ownerWorkerSource;
          contentType = 'application/javascript; charset=utf-8';
        } else if (requested.pathname === '/admin/manifest.webmanifest') {
          body = ownerManifestSource;
          contentType = 'application/manifest+json; charset=utf-8';
        } else {
          const allowed = requiredOwnerAssets.find(asset => '/' + asset === requested.pathname);
          if (!allowed) return new Response('missing asset', { status: 404 });
          body = readRepoFile(allowed);
          if (/\.css$/.test(allowed)) contentType = 'text/css; charset=utf-8';
          else if (/\.js$/.test(allowed)) contentType = 'application/javascript; charset=utf-8';
          else if (/\.svg$/.test(allowed)) contentType = 'image/svg+xml';
          else if (/\.png$/.test(allowed)) contentType = 'image/png';
          else if (/\.webp$/.test(allowed)) contentType = 'image/webp';
        }
        return new Response(body, { headers: { 'content-type': contentType } });
      } } },
      next: async () => new Response('next')
    }
  };
}

function relativeAssetReferences(html) {
  return [...html.matchAll(/\b(src|href)=["']([^"']+)["']/gi)]
    .map(([, attribute, value]) => ({ attribute, value }))
    .filter(({ value }) => !value.startsWith('/') && !value.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(value));
}

{
  const { context, fetched } = makeContext('/admin/');
  const response = await onRequest(context);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(response.headers.get('content-type') || '', /text\/html/i);
  assert.match(body, /href="\/admin\/manifest\.webmanifest"/);
  assert.match(body, /register\("\/admin\/sw\.js",\{scope:"\/admin\/",updateViaCache:"none"\}\)/);
  assert.match(body, /id="ownerInstallBtn"/, "Owner app must expose an install control");
  assert.match(body, /beforeinstallprompt/, "Owner install control must use the native install prompt when available");
  assert.match(body, /appinstalled/, "Owner install control must react when installation completes");
  assert.match(body, /href="\/"/, 'the Customer App link must remain on the public root');
  assert.match(body, /href="#overview"/, 'in-page navigation must remain a fragment');

  for (const { attribute, value } of relativeAssetReferences(sourceHtml)) {
    assert.ok(body.includes(attribute + '="/admin/' + value + '"'), 'relative Owner asset must stay in scope: ' + value);
    const pathname = value.split('?')[0];
    assert.ok(requiredOwnerAssets.includes(pathname), 'Owner HTML references an asset not covered by the route allowlist: ' + pathname);
  }
  assert.deepEqual(fetched.map(item => item.pathname), ['/admin.html']);
}

for (const asset of requiredOwnerAssets) {
  const versionedPath = '/admin/' + asset + (asset.endsWith('.js') ? '?v=qa-1' : '');
  const { context, fetched } = makeContext(versionedPath);
  const response = await onRequest(context);
  assert.equal(response.status, 200, 'Owner-scoped asset should be served: ' + versionedPath);
  assert.match(response.headers.get('cache-control') || '', /no-store/i);
  assert.equal(fetched[0].pathname, '/' + asset, 'asset alias must resolve to the canonical static file: ' + asset);
  assert.equal(fetched[0].search, asset.endsWith('.js') ? '?v=qa-1' : '', 'asset query string must be preserved: ' + asset);
}

{
  const { context, fetched } = makeContext('/admin/sw.js');
  const response = await onRequest(context);
  assert.equal(response.headers.get('service-worker-allowed'), '/admin/');
  assert.match(response.headers.get('content-type') || '', /javascript/i);
  assert.equal(await response.text(), ownerWorkerSource);
  assert.equal(fetched[0].pathname, '/admin/sw.js');
}
{
  const { context } = makeContext('/admin/manifest.webmanifest');
  const response = await onRequest(context);
  assert.match(response.headers.get('content-type') || '', /application\/manifest\+json/i);
  const manifest = await response.json();
  assert.equal(manifest.id, '/admin/freshway-owner');
  assert.equal(manifest.start_url, '/admin/');
  assert.equal(manifest.scope, '/admin/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) assert.ok(icon.src.startsWith('/admin/'), 'Owner install icon must remain under its app path');
}
{
  const { context } = makeContext('/admin/', 'HEAD');
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
}
{
  const { context } = makeContext('/admin/admin.css?v=qa-2', 'HEAD');
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
}
{
  const { context } = makeContext('/admin?from=test');
  const response = await onRequest(context);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), '/admin/?from=test');
}
{
  const { context } = makeContext('/admin/unexpected');
  const response = await onRequest(context);
  assert.equal(response.status, 404);
}
{
  const { context } = makeContext('/admin/sw.js', 'POST');
  const response = await onRequest(context);
  assert.equal(await response.text(), 'next');
}
{
  const shell = [
    '/admin/', '/admin/manifest.webmanifest', ...requiredOwnerAssets.map(path => '/admin/' + path)
  ];
  const urls = [...ownerWorkerSource.matchAll(/'([^']+)'/g)].map(([, value]) => value);
  for (const path of shell) {
    assert.ok(ownerWorkerSource.includes("'" + path + "'") || ownerWorkerSource.includes("'" + path + "?") || path === '/admin/', 'Owner service worker must cache in-scope asset ' + path);
  }
  assert.match(ownerWorkerSource, /const CACHE = 'fw-owner-v\d+'/);
  assert.match(ownerWorkerSource, /key\.startsWith\('fw-owner-'\)/);
  assert.doesNotMatch(ownerWorkerSource, /caches\.delete\(key\).*freshway-/);
  assert.ok(ownerWorkerSource.includes("if (!url.pathname.startsWith('/admin/')) return;"));
  assert.ok(!urls.some(value => value.startsWith('/') && !value.startsWith('/admin/')), 'Owner worker shell must not contain out-of-scope absolute paths');
}
console.log('Owner PWA complete route, asset scope, manifest, service-worker and security contracts OK');
