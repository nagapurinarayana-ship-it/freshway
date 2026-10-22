import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from './admin/[[path]].js';

const readRepoFile = path => readFileSync(new URL('../' + path.replace(/^\//, ''), import.meta.url));
const sourceHtml = readRepoFile('admin.html').toString('utf8');
const customerHtml = readRepoFile('index.html').toString('utf8');
assert.doesNotMatch(customerHtml, /href=["']\/admin(?:\.html|\/?)['"]/i, 'customer app must not expose an Owner dashboard link');
assert.doesNotMatch(customerHtml, /class=["'][^"']*\badmin-link\b/i, 'customer profile must not render an Owner dashboard shortcut');
const invoiceSettingsSource = readRepoFile('frontend/admin/invoice-settings.js').toString('utf8');
const invoiceServiceSource = readRepoFile('worker/src/invoice-service.js').toString('utf8');
assert.ok(sourceHtml.includes('invoice-settings.js?v=20261022-invoice-profile-fallback-v3'), 'Owner app must reference the refreshed optional invoice settings script');
assert.ok(sourceHtml.includes('For a non-GST commercial order record, only the Store Profile name and complete business address are required; other invoice fields may stay blank.'), 'Owner invoice setup must explain the required Store Profile identity/address and optional duplicate fields');
assert.doesNotMatch(sourceHtml, /id="invoiceSeriesPrefix"[^>]*\brequired\b/, 'Invoice series prefix must remain optional and default to FW');
assert.ok(invoiceSettingsSource.includes('saved.enableWarning'), 'Owner UI must explain why attempted invoice activation remains disabled');
assert.ok(invoiceSettingsSource.includes('You can leave unfinished billing and tax details blank and complete them later.'), 'Owner UI must reassure the owner that incomplete settings can be saved');
assert.ok(invoiceServiceSource.includes('let enableWarning=') && invoiceServiceSource.includes('enableWarning?{enableWarning}:{}'), 'Worker must save partial settings and return a safe activation warning');
const ownerLiveSmokeSource = readRepoFile('pwa-owner-live-smoke.mjs').toString('utf8');
assert.ok(ownerLiveSmokeSource.includes("const EXPECTED_OWNER_CSS = '/admin/admin.css?v=20261022-invoice-ui-v1';"), 'production Owner smoke must demand the current Owner CSS version');
assert.ok(ownerLiveSmokeSource.includes("const EXPECTED_OWNER_ADMIN_SCRIPT = '/admin/admin.js?v=20261022-invoice-api-fallback-v2';"), 'production Owner smoke must demand the current admin.js version');
assert.ok(ownerLiveSmokeSource.includes("const EXPECTED_OWNER_INVOICE_SETTINGS_SCRIPT = '/admin/frontend/admin/invoice-settings.js?v=20261022-invoice-profile-fallback-v3';"), 'production Owner smoke must demand the current optional invoice settings script');

assert.ok(ownerLiveSmokeSource.includes("const EXPECTED_OWNER_ALERTS_SCRIPT = '/admin/frontend/admin/order-alerts.js?v=20261021-owner-push-diagnostics-v1';"), 'production Owner smoke must demand the current push setup version');
assert.ok(ownerLiveSmokeSource.includes("const EXPECTED_OWNER_STORE_PROFILE_SCRIPT = '/admin/frontend/admin/store-profile.js?v=20261022-pin-save-v2';"), 'production Owner smoke must demand the current business profile and shop pin editor');
assert.ok(ownerLiveSmokeSource.includes("const EXPECTED_OWNER_LIFECYCLE_SCRIPT = '/admin/owner-lifecycle.js?v=20261021-open-map-fix-v1';"), 'production Owner smoke must demand the cache-busted order lifecycle map handler');
assert.ok(ownerLiveSmokeSource.includes("const EXPECTED_OWNER_CACHE = 'fw-owner-v27';"), 'production Owner smoke must demand the current service-worker cache');
assert.match(ownerLiveSmokeSource, /fetchCurrentOwnerAppShell/);
assert.match(ownerLiveSmokeSource, /fetchCurrentOwnerServiceWorker/);
assert.ok(ownerLiveSmokeSource.includes("const pathname = String(path).split('?')[0];"), 'Owner cache smoke must classify assets by pathname, not URL including query');
assert.ok(ownerLiveSmokeSource.includes("const hasVersion = /[?&]v=[^&]+/.test(String(path));"), 'Owner cache smoke must distinguish versioned assets by query');
const ownerManifestSource = readRepoFile('admin/manifest.webmanifest').toString('utf8');
const ownerWorkerSource = readRepoFile('admin/sw.js').toString('utf8');
const ownerInstallSource = readRepoFile('owner-pwa-install.js').toString('utf8');
const requiredOwnerAssets = [
  'admin.css',
  'admin.js',
  'owner-pwa-install.js',
  'owner-pwa-install.css',
  'freshway-logo-master.webp',
  'freshway-logo-clean.svg',
  'frontend/phone-display.js',
  'frontend/admin/store-profile.js',
  'frontend/admin/invoice-settings.js',
  'frontend/catalogue-media.js',
  'frontend/admin/catalogue.js',
  'frontend/admin/owner-lifecycle-autosave.js',
  'frontend/admin/push.js',
  'frontend/admin/order-alerts.js',
  'owner-lifecycle.js',
  'owner-address-final.js',
  'frontend/media/catalogue/groundnut-oil.svg',
  'frontend/media/catalogue/sunflower-oil.svg',
  'frontend/media/catalogue/hmt-rice.svg',
  'frontend/media/catalogue/sona-masuri.svg',
  'icons/icon-192.svg',
  'icons/icon-512.svg'
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

function assertVersionedCodeReferences(html, label) {
  for (const [, tag] of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const isScript = tag.toLowerCase().startsWith('<script');
    const isStylesheet = tag.toLowerCase().startsWith('<link') && /\brel=["']stylesheet["']/i.test(tag);
    if (!isScript && !isStylesheet) continue;
    const match = tag.match(isScript ? /\bsrc=["']([^"']+)["']/i : /\bhref=["']([^"']+)["']/i);
    if (!match || !/\.(?:js|css)(?:\?|$)/i.test(match[1]) || /^[a-z][a-z0-9+.-]*:/i.test(match[1])) continue;
    assert.match(match[1], /[?&]v=[^&]+/, label + ' code asset must carry a version query: ' + match[1]);
  }
}
assertVersionedCodeReferences(customerHtml, 'Customer app');
assertVersionedCodeReferences(sourceHtml, 'Owner app');

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
  assert.match(body, /id="owner-alert-history"/, 'Owner alert history must have a dedicated screen');
  assert.match(body, /View all notifications/, 'Owner notifications must show a compact preview with a View all action');
  assert.match(body, /id="clearOwnerAlertHistory"/, 'Owner notification history must offer delete-all controls');
  const ownerAlertsSource = readRepoFile('frontend/admin/order-alerts.js').toString('utf8');
  assert.match(ownerAlertsSource, /data-delete-owner-alert/, 'Owner notification history renderer must provide per-alert deletion controls');
  assert.match(body, /data-owner-install/, "Owner app must expose install controls");
  assert.match(body, /class="primary owner-install-hero"[^>]*data-owner-install/, "Owner install action must be visible in the mobile dashboard when installable");
  assert.ok(body.includes('src="/admin/owner-pwa-install.js?v=20261019-install-prompt-v2'));
  assert.ok(ownerInstallSource.includes("register('/admin/sw.js', { scope: '/admin/'"));
  assert.match(ownerInstallSource, /beforeinstallprompt/, "Owner install control must use the native install prompt when available");
  assert.match(ownerInstallSource, /appinstalled/, "Owner install control must react when installation completes");
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
  const versionedCodeAsset = /\.(?:js|css)$/i.test(asset);
  const versionedPath = '/admin/' + asset + (versionedCodeAsset ? '?v=qa-1' : '');
  const { context, fetched } = makeContext(versionedPath);
  const response = await onRequest(context);
  assert.equal(response.status, 200, 'Owner-scoped asset should be served: ' + versionedPath);
  const assetCacheControl = response.headers.get('cache-control') || '';
  if (versionedCodeAsset) {
    assert.match(assetCacheControl, /public/i, 'versioned Owner code must be public-cacheable: ' + asset);
    assert.match(assetCacheControl, /max-age=31536000/i, 'versioned Owner code must use a long-lived cache: ' + asset);
    assert.match(assetCacheControl, /immutable/i, 'versioned Owner code must be immutable: ' + asset);
  } else {
    assert.match(assetCacheControl, /public/i, 'Owner media must be public-cacheable: ' + asset);
    assert.match(assetCacheControl, /max-age=86400/i, 'Owner media must use a bounded cache lifetime: ' + asset);
    assert.match(assetCacheControl, /must-revalidate/i, 'Owner media must revalidate after expiry: ' + asset);
  }
  assert.equal(fetched[0].pathname, '/' + asset, 'asset alias must resolve to the canonical static file: ' + asset);
  assert.equal(fetched[0].search, versionedCodeAsset ? '?v=qa-1' : '', 'asset query string must be preserved: ' + asset);
}

{
  const { context, fetched } = makeContext('/admin/sw.js?v=qa-1');
  const response = await onRequest(context);
  assert.match(response.headers.get('cache-control') || '', /no-store/i, 'service worker must remain fresh even if v is supplied');
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
